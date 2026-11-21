import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@wrenlore/db/types/kysely.types';
import { SpaceMemberRepo } from '@wrenlore/db/repos/space/space-member.repo';
import { PageHistoryRepo } from '@wrenlore/db/repos/page/page-history.repo';
import { CommentRepo } from '@wrenlore/db/repos/comment/comment.repo';
import { AgentTokenService } from '../agent-tokens/agent-token.service';
import { AgentIdentity } from '../agent-tokens/agent-token.types';
import { PageService } from '../page/services/page.service';
import { SearchService } from '../search/search.service';
import { CollaborationGateway } from '../../collaboration/collaboration.gateway';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { CommentService } from '../comment/comment.service';
import { McpToolName, mcpTools } from './mcp.schemas';
import { hash, parseMarkdown, readBlocks } from './document-edits';
import { jsonToMarkdown } from '../../collaboration/collaboration.util';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';

@Injectable()
export class AgentOperationsService {
  private readonly logger = new Logger(AgentOperationsService.name);
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tokens: AgentTokenService,
    private readonly members: SpaceMemberRepo,
    private readonly pages: PageService,
    private readonly histories: PageHistoryRepo,
    private readonly comments: CommentRepo,
    private readonly search: SearchService,
    private readonly collab: CollaborationGateway,
    private readonly env: EnvironmentService,
    private readonly commentService: CommentService,
  ) {}

  private summary(page: any) {
    return {
      id: page.id,
      title: page.title,
      spaceId: page.spaceId,
      parentPageId: page.parentPageId,
      url: `${this.env.getAppUrl()}/s/${page.space?.slug ?? page.spaceId}/p/${page.slugId}`,
    };
  }

  async call(actor: AgentIdentity, name: string, input: unknown): Promise<any> {
    if (!Object.prototype.hasOwnProperty.call(mcpTools, name))
      throw new NotFoundException('Unknown tool');
    const tool = mcpTools[name as McpToolName];
    const parsed = tool.input.safeParse(input ?? {});
    if (!parsed.success)
      throw new BadRequestException({
        code: 'INVALID_ARGUMENTS',
        message: 'Correct the named arguments and call this tool again.',
        issues: parsed.error.issues,
      });
    const args: any = parsed.data;
    actor = await this.tokens.resolve(actor.tokenId, actor.workspace.id);
    if (tool.write) this.tokens.assertWrite(actor);
    switch (name as McpToolName) {
      case 'get_context':
        return {
          user: { id: actor.user.id, name: actor.user.name },
          agentName: actor.agentName,
          attribution: `${actor.user.name}, via ${actor.agentName}`,
          workspace: { id: actor.workspace.id, name: actor.workspace.name },
          access: actor.access,
          spaceIds: actor.spaceIds,
          tools: Object.entries(mcpTools)
            .filter(([, t]) => !t.write || actor.access === 'write')
            .map(([n]) => n),
        };
      case 'list_spaces': {
        let query = this.db
          .selectFrom('spaces')
          .select(['id', 'name', 'slug', 'description'])
          .where('workspaceId', '=', actor.workspace.id)
          .where('deletedAt', 'is', null)
          .where('id', 'in', this.members.getUserSpaceIdsQuery(actor.user.id))
          .orderBy('id')
          .offset(args.offset)
          .limit(args.limit + 1);
        if (actor.spaceIds !== null)
          query = query.where('id', 'in', actor.spaceIds);
        const rows = await query.execute();
        return {
          items: rows.slice(0, args.limit),
          nextOffset:
            rows.length > args.limit ? args.offset + args.limit : null,
        };
      }
      case 'list_pages': {
        const space = await this.tokens.requireSpace(actor, args.spaceId);
        const parent = args.parentPageId
          ? await this.tokens.requirePage(actor, args.parentPageId)
          : null;
        if (parent && parent.spaceId !== space.id)
          throw new NotFoundException(
            'Parent page not available in this space',
          );
        let query = this.db
          .selectFrom('pages')
          .select(['id', 'slugId', 'title', 'spaceId', 'parentPageId'])
          .where('workspaceId', '=', actor.workspace.id)
          .where('spaceId', '=', space.id)
          .where('deletedAt', 'is', null)
          .where(this.search.accessiblePagePredicate(actor.user.id))
          .orderBy('position')
          .orderBy('id')
          .offset(args.offset)
          .limit(args.limit + 1);
        query = parent
          ? query.where('parentPageId', '=', parent.id)
          : query.where('parentPageId', 'is', null);
        const rows = await query.execute();
        return {
          items: rows
            .slice(0, args.limit)
            .map((p) => this.summary({ ...p, space })),
          nextOffset:
            rows.length > args.limit ? args.offset + args.limit : null,
        };
      }
      case 'search': {
        if (args.spaceId) await this.tokens.requireSpace(actor, args.spaceId);
        const found = await this.search.searchPage(
          { ...args, limit: args.limit + 1 },
          {
            userId: actor.user.id,
            workspaceId: actor.workspace.id,
            allowedSpaceIds: actor.spaceIds ?? undefined,
          },
        );
        return {
          items: found.items.slice(0, args.limit).map((p: any) => ({
            ...this.summary({ ...p, spaceId: p.space?.id }),
            excerpt: p.highlight?.slice(0, 1000),
          })),
          nextOffset:
            found.items.length > args.limit ? args.offset + args.limit : null,
        };
      }
      case 'read_page':
      case 'edit_page': {
        const page = await this.tokens.requirePage(
          actor,
          args.pageId,
          tool.write,
        );
        const response = await this.collab.handleYjsEvent(
          tool.write ? 'agentEdit' : 'agentRead',
          `page.${page.id}`,
          {
            tokenId: actor.tokenId,
            workspaceId: actor.workspace.id,
            args: { ...args, pageId: page.id },
          },
        );
        if (!response?.ok)
          throw new HttpException(
            response?.error ?? {
              code: 'COLLABORATION_UNAVAILABLE',
              message: 'Retry the request; preserve requestKey for an edit.',
            },
            response?.status ?? 503,
          );
        return { ...this.summary(page), ...response.result };
      }
      case 'create_page': {
        await this.tokens.requireSpace(actor, args.spaceId, true);
        if (args.parentPageId) {
          const parent = await this.tokens.requirePage(
            actor,
            args.parentPageId,
            true,
          );
          if (parent.spaceId !== args.spaceId)
            throw new BadRequestException(
              'Parent must belong to the selected space',
            );
          args.parentPageId = parent.id;
        }
        const result = await this.writeOnce(
          actor,
          name,
          args,
          async (trx, current) => {
            const space = await this.tokens.requireSpace(
              current,
              args.spaceId,
              true,
              trx,
            );
            if (args.parentPageId)
              await this.tokens.requirePage(
                current,
                args.parentPageId,
                true,
                trx,
              );
            const page = await this.pages.create(
              current.user.id,
              current.workspace.id,
              {
                spaceId: args.spaceId,
                parentPageId: args.parentPageId,
                title: args.title,
                content: args.markdown,
                format: 'markdown',
              } as any,
              trx,
            );
            await this.histories.saveHistory(page, {
              trx,
              agentName: current.agentName,
              contributorIds: [current.user.id],
            });
            return {
              ...this.summary({ ...page, space }),
              pageId: page.id,
              spaceId: page.spaceId,
              persisted: true,
            };
          },
        );
        if (!result.replayed) {
          const created = await this.pages.findById(result.pageId);
          this.pages.notifyCreated(created);
        }
        return result;
      }
      case 'list_comments': {
        const page = await this.tokens.requirePage(actor, args.pageId);
        if (args.commentId) {
          const comment = await this.comments.findById(args.commentId, {
            includeCreator: true,
            includeResolvedBy: true,
          });
          if (!comment || comment.deletedAt || comment.pageId !== page.id)
            throw new NotFoundException('Comment not available');
          const markdown = jsonToMarkdown(comment.content);
          if (args.charOffset > markdown.length)
            throw new BadRequestException('charOffset exceeds comment length');
          const end = Math.min(
            markdown.length,
            args.charOffset + args.maxChars,
          );
          return {
            id: comment.id,
            author: comment.creator?.name,
            agentName: comment.agentName,
            markdown: markdown.slice(args.charOffset, end),
            nextCharOffset: end < markdown.length ? end : null,
          };
        }
        const rows = await this.db
          .selectFrom('comments')
          .innerJoin('users', 'users.id', 'comments.creatorId')
          .select([
            'comments.id',
            'comments.content',
            'comments.parentCommentId',
            'comments.agentName',
            'comments.createdAt',
            'comments.resolvedAt',
            'users.name as author',
            'comments.creatorId',
          ])
          .where('comments.pageId', '=', page.id)
          .where('comments.deletedAt', 'is', null)
          .orderBy('comments.id')
          .limit(args.limit + 1)
          .offset(args.offset)
          .execute();
        return {
          items: rows.slice(0, args.limit).map(({ content, ...r }) => {
            const text = jsonToMarkdown(content);
            return {
              ...r,
              markdown: text.slice(0, 4000),
              truncated: text.length > 4000,
            };
          }),
          nextOffset:
            rows.length > args.limit ? args.offset + args.limit : null,
        };
      }
      case 'add_comment': {
        const page = await this.tokens.requirePage(actor, args.pageId, true);
        const content = await parseMarkdown(args.markdown);
        const result = await this.writeOnce(
          actor,
          name,
          args,
          async (trx, current) => {
            const page = await this.tokens.requirePage(
              current,
              args.pageId,
              true,
              trx,
            );
            if (args.parentCommentId) {
              const parent = await trx
                .selectFrom('comments')
                .selectAll()
                .where('id', '=', args.parentCommentId)
                .where('pageId', '=', page.id)
                .where('deletedAt', 'is', null)
                .executeTakeFirst();
              if (!parent || parent.parentCommentId)
                throw new BadRequestException(
                  'Reply target must be a top-level comment on this page',
                );
            }
            const comment = await this.comments.insertComment(
              {
                pageId: page.id,
                workspaceId: page.workspaceId,
                spaceId: page.spaceId,
                creatorId: current.user.id,
                agentName: current.agentName,
                content,
                type: 'page',
                parentCommentId: args.parentCommentId,
              },
              trx,
            );
            return {
              commentId: comment.id,
              pageId: page.id,
              spaceId: page.spaceId,
              persisted: true,
            };
          },
        );
        if (!result.replayed) {
          const comment = await this.comments.findById(result.commentId, {
            includeCreator: true,
            includeResolvedBy: true,
          });
          await this.commentService
            .notifyCreated(comment)
            .catch((error) =>
              this.logger.warn(
                `Agent comment saved; notification failed: ${error.message}`,
              ),
            );
        }
        return result;
      }
      case 'get_page_history': {
        const page = await this.tokens.requirePage(actor, args.pageId);
        if (args.historyId) {
          const revision = await this.histories.findById(args.historyId, {
            includeContent: true,
          });
          if (
            !revision ||
            revision.pageId !== page.id ||
            revision.workspaceId !== actor.workspace.id
          )
            throw new NotFoundException('Revision not available');
          return {
            id: revision.id,
            title: revision.title,
            agentName: revision.agentName,
            ...readBlocks(revision.content, { ...args, format: 'blocks' }),
          };
        }
        const rows = await this.db
          .selectFrom('pageHistory')
          .leftJoin('users', 'users.id', 'pageHistory.lastUpdatedById')
          .select([
            'pageHistory.id',
            'pageHistory.title',
            'pageHistory.createdAt',
            'pageHistory.agentName',
            'pageHistory.lastUpdatedById',
            'users.name as author',
          ])
          .where('pageHistory.pageId', '=', page.id)
          .orderBy('pageHistory.createdAt', 'desc')
          .orderBy('pageHistory.id', 'desc')
          .limit(args.limit + 1)
          .offset(args.offset)
          .execute();
        return {
          items: rows.slice(0, args.limit),
          nextOffset:
            rows.length > args.limit ? args.offset + args.limit : null,
        };
      }
    }
  }

  private async writeOnce(
    actor: AgentIdentity,
    tool: string,
    args: any,
    action: (trx: KyselyTransaction, current: AgentIdentity) => Promise<any>,
  ) {
    const fingerprint = hash({ tool, args });
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${actor.tokenId + ':' + args.requestKey}, 0))`.execute(
        trx,
      );
      const current = await this.tokens.resolve(
        actor.tokenId,
        actor.workspace.id,
        trx,
      );
      this.tokens.assertWrite(current);
      if (args.spaceId)
        await this.tokens.requireSpace(current, args.spaceId, true, trx);
      if (args.pageId)
        await this.tokens.requirePage(current, args.pageId, true, trx);
      if (args.parentPageId)
        await this.tokens.requirePage(current, args.parentPageId, true, trx);
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
            message: 'Use a new requestKey for different arguments.',
          });
        if (!existing.result)
          throw new ConflictException(
            'Operation is not complete; retry the same request',
          );
        if ((existing.result as any).pageId)
          await this.tokens.requirePage(
            current,
            (existing.result as any).pageId,
            true,
            trx,
          );
        return { ...(existing.result as any), replayed: true };
      }
      const result = {
        ...(await action(trx, current)),
        userId: current.user.id,
        agentName: current.agentName,
      };
      const id = randomUUID();
      await trx
        .insertInto('agentOperations')
        .values({
          id,
          tokenId: actor.tokenId,
          workspaceId: actor.workspace.id,
          requestKey: args.requestKey,
          requestHash: fingerprint,
          tool,
          result,
        })
        .execute();
      await trx
        .insertInto('audit')
        .values({
          workspaceId: actor.workspace.id,
          actorId: actor.user.id,
          actorType: 'user',
          event: `agent.${tool}`,
          resourceType: tool === 'add_comment' ? 'comment' : 'page',
          resourceId: result.commentId ?? result.pageId,
          spaceId: result.spaceId,
          metadata: {
            agentName: current.agentName,
            tokenId: current.tokenId,
            operationId: id,
          },
        })
        .execute();
      return result;
    });
  }
}
