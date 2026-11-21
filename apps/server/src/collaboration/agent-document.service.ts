import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';
import { PageHistoryRepo } from '@wrenlore/db/repos/page/page-history.repo';
import { AgentTokenService } from '../core/agent-tokens/agent-token.service';
import { agentPerformedAuditMetadata } from '../common/audit/agent-audit';
import {
  assertRevision,
  documentRevision,
  hash,
  parseMarkdown,
  planEdits,
  readBlocks,
} from '../core/mcp/document-edits';
import { DocumentWriteQueue } from './document-write-queue';
import { Hocuspocus } from '@hocuspocus/server';
import { TiptapTransformer } from '@hocuspocus/transformer';
import { jsonToText, prosemirrorNodeToYElement } from './collaboration.util';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { EnvironmentService } from '../integrations/environment/environment.service';
import { PersistenceExtension } from './extensions/persistence.extension';
import * as Y from 'yjs';
import { sql } from 'kysely';

export interface AgentDocumentRequest {
  tokenId: string;
  workspaceId: string;
  args: any;
}

@Injectable()
export class AgentDocumentService {
  private readonly logger = new Logger(AgentDocumentService.name);
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tokens: AgentTokenService,
    private readonly history: PageHistoryRepo,
    private readonly queue: DocumentWriteQueue,
    private readonly env: EnvironmentService,
    private readonly persistence: PersistenceExtension,
  ) {}

  async handle(
    hocuspocus: Hocuspocus,
    documentName: string,
    request: AgentDocumentRequest,
    write: boolean,
  ) {
    // Errors are serialized explicitly: the Redis custom-event transport only
    // transports fulfilled results, not thrown exceptions.
    try {
      const actor = await this.tokens.resolve(
        request.tokenId,
        request.workspaceId,
      );
      const page = await this.tokens.requirePage(
        actor,
        request.args.pageId,
        write,
      );
      if (documentName !== `page.${page.id}`)
        throw new BadRequestException('Document identity mismatch');
      const connection = await hocuspocus.openDirectConnection(documentName, {
        user: actor.user,
      });
      try {
        const doc = hocuspocus.documents.get(documentName);
        return {
          ok: true,
          result: await this.queue.run(documentName, () =>
            this.execute(doc, request, write),
          ),
        };
      } finally {
        // disconnect flushes onStoreDocument; it must run outside our queue.
        await connection.disconnect();
      }
    } catch (error) {
      if (error instanceof HttpException)
        return {
          ok: false,
          status: error.getStatus(),
          error: error.getResponse(),
        };
      this.logger.error(
        'Agent document operation could not be confirmed',
        error instanceof Error ? error.stack : undefined,
      );
      return {
        ok: false,
        status: 503,
        error: {
          code: 'SAVE_UNCONFIRMED',
          message:
            'The operation could not be confirmed. Retry with the same requestKey and identical arguments.',
        },
      };
    }
  }

  private signReceipt(operation: any, receipt: any) {
    return createHmac('sha256', this.env.getAppSecret())
      .update(
        JSON.stringify({
          domain: 'wrenlore-agent-edit-v1',
          operationId: operation.id,
          tokenId: operation.tokenId,
          requestHash: operation.requestHash,
          receipt,
        }),
      )
      .digest('hex');
  }

  private async execute(
    doc: Y.Doc,
    request: AgentDocumentRequest,
    write: boolean,
  ) {
    let actor = await this.tokens.resolve(request.tokenId, request.workspaceId);
    let page = await this.tokens.requirePage(actor, request.args.pageId, write);
    const args = request.args;
    const parsed = write
      ? await Promise.all(
          args.operations.map(async (op: any) => ({
            ...op,
            nodes: (await parseMarkdown(op.markdown)).content ?? [],
          })),
        )
      : [];
    const content = () => TiptapTransformer.fromYdoc(doc, 'default');
    actor = await this.tokens.resolve(request.tokenId, request.workspaceId);
    page = await this.tokens.requirePage(actor, page.id, write);
    if (!write)
      return {
        revision: documentRevision(page.title, content()),
        ...readBlocks(content(), args),
      };
    if (!parsed.length)
      throw new BadRequestException('Supply at least one edit operation');
    const fingerprint = hash({ tool: 'edit_page', args });
    const operation = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${actor.tokenId + ':' + args.requestKey}, 0))`.execute(
        trx,
      );
      const existing = await trx
        .selectFrom('agentOperations')
        .selectAll()
        .where('tokenId', '=', actor.tokenId)
        .where('requestKey', '=', args.requestKey)
        .executeTakeFirst();
      if (existing) {
        if (existing.requestHash !== fingerprint)
          throw new ConflictException({
            code: 'REQUEST_KEY_CONFLICT',
            message:
              'This requestKey already belongs to different arguments. Use a new key for a different operation.',
          });
        return existing;
      }
      assertRevision(page.title, content(), args.expectedRevision);
      // Capture the live pre-edit document, including browser edits not yet in
      // the debounced SQL snapshot. This snapshot commits before any mutation.
      await this.history.saveHistory({ ...page, content: content() } as any, {
        trx,
      });
      return trx
        .insertInto('agentOperations')
        .values({
          id: randomUUID(),
          tokenId: actor.tokenId,
          workspaceId: actor.workspace.id,
          requestKey: args.requestKey,
          requestHash: fingerprint,
          tool: 'edit_page',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    if (operation.result)
      return { ...(operation.result as any), replayed: true };
    const journal = doc.getMap<any>('wrenloreAgentOperations');
    const entry = journal.get(operation.id);
    let receipt = entry?.receipt;
    if (entry) {
      const signature = Buffer.from(
        typeof entry.signature === 'string' ? entry.signature : '',
        'hex',
      );
      const expected = Buffer.from(this.signReceipt(operation, receipt), 'hex');
      if (
        signature.length !== expected.length ||
        !timingSafeEqual(signature, expected) ||
        receipt?.pageId !== page.id
      ) {
        throw new ConflictException({
          code: 'OPERATION_JOURNAL_CONFLICT',
          message:
            'The saved edit receipt is invalid. Read the page and review its history before submitting a new operation.',
        });
      }
    }
    if (!receipt) {
      // Recheck after the asynchronous prepare step, immediately before the
      // synchronous CRDT transaction. No network/SQL work inside the mutation.
      actor = await this.tokens.resolve(request.tokenId, request.workspaceId);
      page = await this.tokens.requirePage(actor, page.id, true);
      doc.transact(
        () => {
          const before = content();
          assertRevision(page.title, before, args.expectedRevision);
          const edits = planEdits(before, parsed);
          const fragment = doc.getXmlFragment('default');
          for (const edit of edits) {
            // Convert first: a malformed node must never leave half an edit.
            edit['elements'] = edit.nodes.map(prosemirrorNodeToYElement);
          }
          for (const edit of edits) {
            if (edit.remove) fragment.delete(edit.index, edit.remove);
            if (edit['elements'].length)
              fragment.insert(edit.index, edit['elements']);
          }
          receipt = {
            pageId: page.id,
            revision: documentRevision(page.title, content()),
          };
          journal.set(operation.id, {
            receipt,
            signature: this.signReceipt(operation, receipt),
          });
        },
        { agentTokenId: actor.tokenId },
      );
    }
    // A previous attempt may have applied the CRDT edit but lost its save
    // acknowledgement. The journal is persisted in ydoc with the content;
    // retries flush it without reapplying the mutation.
    const savedContent = content();
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const result = {
      pageId: page.id,
      revision: receipt.revision,
      persistedRevision: documentRevision(page.title, savedContent),
      persisted: true,
      agentName: actor.agentName,
      userId: actor.user.id,
    };
    await this.db.transaction().execute(async (trx) => {
      const currentPage = await trx
        .selectFrom('pages')
        .select(['title', 'contributorIds'])
        .where('id', '=', page.id)
        .where('deletedAt', 'is', null)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('pages')
        .set({
          content: savedContent as any,
          textContent: jsonToText(savedContent),
          ydoc: state,
          updatedAt: new Date(),
          lastUpdatedById: actor.user.id,
          contributorIds: [
            ...new Set([...(currentPage.contributorIds ?? []), actor.user.id]),
          ],
        })
        .where('id', '=', page.id)
        .execute();
      await trx
        .insertInto('pageHistory')
        .values({
          id: operation.id,
          pageId: page.id,
          slugId: page.slugId,
          title: currentPage.title,
          content: savedContent as any,
          lastUpdatedById: actor.user.id,
          contributorIds: [actor.user.id],
          agentName: actor.agentName,
          spaceId: page.spaceId,
          workspaceId: page.workspaceId,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
      await trx
        .updateTable('agentOperations')
        .set({ result: result as any })
        .where('id', '=', operation.id)
        .execute();
      await trx
        .insertInto('audit')
        .values({
          workspaceId: page.workspaceId,
          actorId: actor.user.id,
          actorType: 'user',
          event: 'agent.page_edited',
          resourceType: 'page',
          resourceId: page.id,
          spaceId: page.spaceId,
          metadata: agentPerformedAuditMetadata(actor, {
            operationId: operation.id,
          }),
        })
        .execute();
    });
    await this.persistence
      .afterAgentSave(page, savedContent, actor.user.id)
      .catch((error) =>
        this.logger.warn(
          `Agent edit saved; follow-up indexing failed: ${error.message}`,
        ),
      );
    return result;
  }
}
