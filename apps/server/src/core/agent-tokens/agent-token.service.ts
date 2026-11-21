import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@wrenlore/db/types/kysely.types';
import { dbOrTx } from '@wrenlore/db/utils';
import { UserRepo } from '@wrenlore/db/repos/user/user.repo';
import { WorkspaceRepo } from '@wrenlore/db/repos/workspace/workspace.repo';
import { PageRepo } from '@wrenlore/db/repos/page/page.repo';
import { PageAccessService } from '../page/page-access/page-access.service';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { isUserDisabled } from '../../common/helpers';
import { User, Workspace } from '@wrenlore/db/types/entity.types';
import { AgentIdentity } from './agent-token.types';
import { z } from 'zod';

export const createAgentTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    agentName: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(
        (s) => !/[\x00-\x1f\x7f]/.test(s),
        'Agent name must not contain control characters',
      ),
    access: z.enum(['read', 'write']),
    spaceIds: z.array(z.uuid()).min(1).max(100).nullable().default(null),
    expiresAt: z.iso.datetime().nullable().default(null),
  })
  .strict();

const publicFields = [
  'id',
  'name',
  'agentName',
  'access',
  'spaceIds',
  'createdAt',
  'expiresAt',
  'lastUsedAt',
  'deletedAt',
] as const;
const digest = (token: string) => createHash('sha256').update(token).digest();

@Injectable()
export class AgentTokenService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly users: UserRepo,
    private readonly workspaces: WorkspaceRepo,
    private readonly pages: PageRepo,
    private readonly pageAccess: PageAccessService,
    private readonly spaces: SpaceAbilityFactory,
  ) {}

  async list(user: User) {
    return this.db
      .selectFrom('apiKeys')
      .select(publicFields)
      .where('workspaceId', '=', user.workspaceId)
      .where('creatorId', '=', user.id)
      .where('tokenHash', 'is not', null)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  async create(user: User, workspace: Workspace, input: unknown) {
    const parsed = createAgentTokenSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const args = parsed.data;
    this.assertEnabled(workspace, user);
    if (args.expiresAt && new Date(args.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('Expiry must be in the future');
    }
    const identity: AgentIdentity = { user, workspace, tokenId: '', ...args };
    for (const id of args.spaceIds ?? []) await this.requireSpace(identity, id);
    const id = randomUUID();
    const token = `wrl_${id}.${randomBytes(32).toString('base64url')}`;
    const row = await this.db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('apiKeys')
        .values({
          id,
          name: args.name,
          agentName: args.agentName,
          access: args.access,
          spaceIds: args.spaceIds,
          tokenHash: digest(token).toString('hex'),
          creatorId: user.id,
          workspaceId: workspace.id,
          expiresAt: args.expiresAt ? new Date(args.expiresAt) : null,
        })
        .returning(publicFields)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('audit')
        .values({
          workspaceId: workspace.id,
          actorId: user.id,
          actorType: 'user',
          event: 'agent.token_created',
          resourceType: 'api_key',
          resourceId: id,
          metadata: {
            agentName: args.agentName,
            access: args.access,
            spaceIds: args.spaceIds,
            expiresAt: args.expiresAt,
          },
        })
        .execute();
      return created;
    });
    return { ...row, token };
  }

  async revoke(user: User, id: string) {
    if (!z.uuid().safeParse(id).success)
      throw new BadRequestException('Invalid token ID');
    return this.db.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable('apiKeys')
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where('id', '=', id)
        .where('creatorId', '=', user.id)
        .where('workspaceId', '=', user.workspaceId)
        .returning('id')
        .executeTakeFirst();
      if (!result) throw new NotFoundException('Token not found');
      await trx
        .insertInto('audit')
        .values({
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorType: 'user',
          event: 'agent.token_revoked',
          resourceType: 'api_key',
          resourceId: id,
        })
        .execute();
      return { revoked: true };
    });
  }

  async authenticate(
    header: string | undefined,
    workspaceId: string,
  ): Promise<AgentIdentity> {
    const match = /^Bearer (wrl_([0-9a-f-]{36})\.[A-Za-z0-9_-]{43})$/i.exec(
      header ?? '',
    );
    if (!match || !z.uuid().safeParse(match[2]).success || !workspaceId)
      throw new UnauthorizedException('Valid agent bearer token required');
    const row = await this.db
      .selectFrom('apiKeys')
      .selectAll()
      .where('id', '=', match[2])
      .executeTakeFirst();
    const expected = Buffer.from(row?.tokenHash ?? '', 'hex');
    if (expected.length !== 32 || !timingSafeEqual(expected, digest(match[1])))
      throw new UnauthorizedException('Invalid agent token');
    const actor = await this.resolve(row.id, workspaceId);
    await this.db
      .updateTable('apiKeys')
      .set({ lastUsedAt: new Date() })
      .where('id', '=', row.id)
      .execute();
    return actor;
  }

  // Also called on the document-owning collaboration process immediately before an edit.
  // Internal callers supply an authenticated token ID, never an actor supplied by an MCP client.
  async resolve(
    tokenId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<AgentIdentity> {
    const row = await dbOrTx(this.db, trx)
      .selectFrom('apiKeys')
      .selectAll()
      .where('id', '=', tokenId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    if (
      !row?.tokenHash ||
      !row.agentName ||
      row.deletedAt ||
      (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now())
    ) {
      throw new UnauthorizedException('Agent token expired or revoked');
    }
    const [user, workspace] = await Promise.all([
      this.users.findById(row.creatorId, workspaceId, { trx }),
      this.workspaces.findById(workspaceId, { trx }),
    ]);
    if (!user || isUserDisabled(user) || !workspace || workspace.deletedAt)
      throw new UnauthorizedException('Account unavailable');
    this.assertEnabled(workspace, user);
    if (row.access !== 'read' && row.access !== 'write')
      throw new UnauthorizedException('Invalid token access');
    return {
      user,
      workspace,
      tokenId,
      agentName: row.agentName,
      access: row.access,
      spaceIds: row.spaceIds,
    };
  }

  assertEnabled(workspace: Workspace, user: User) {
    if (workspace.settings?.['ai']?.['mcp'] !== true)
      throw new ForbiddenException('MCP is disabled for this workspace');
    if (
      workspace.settings?.['api']?.['restrictToAdmins'] === true &&
      !['owner', 'admin'].includes(user.role)
    ) {
      throw new ForbiddenException(
        'Agent access is restricted to workspace administrators',
      );
    }
  }

  assertSpaceScope(actor: AgentIdentity, id: string) {
    if (actor.spaceIds !== null && !actor.spaceIds.includes(id))
      throw new NotFoundException('Space or page not available');
  }

  assertWrite(actor: AgentIdentity) {
    if (actor.access !== 'write')
      throw new ForbiddenException('This token is read-only');
  }

  async requireSpace(
    actor: AgentIdentity,
    id: string,
    create = false,
    trx?: KyselyTransaction,
  ) {
    this.assertSpaceScope(actor, id);
    const space = await dbOrTx(this.db, trx)
      .selectFrom('spaces')
      .selectAll()
      .where('id', '=', id)
      .where('workspaceId', '=', actor.workspace.id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!space) throw new NotFoundException('Space not available');
    const ability = await this.spaces.createForUser(actor.user, id, trx);
    if (
      ability.cannot(
        create ? SpaceCaslAction.Create : SpaceCaslAction.Read,
        SpaceCaslSubject.Page,
      )
    )
      throw new NotFoundException('Space not available');
    if (create) this.assertWrite(actor);
    return space;
  }

  async requirePage(
    actor: AgentIdentity,
    id: string,
    write = false,
    trx?: KyselyTransaction,
  ) {
    const page = await this.pages.findById(id, {
      includeContent: true,
      includeSpace: true,
      trx,
    });
    if (!page || page.deletedAt || page.workspaceId !== actor.workspace.id)
      throw new NotFoundException('Page not available');
    this.assertSpaceScope(actor, page.spaceId);
    const space = await dbOrTx(this.db, trx)
      .selectFrom('spaces')
      .select('id')
      .where('id', '=', page.spaceId)
      .where('workspaceId', '=', actor.workspace.id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!space) throw new NotFoundException('Page not available');
    // PageAccessService handles explicit/inherited grants as well as ordinary
    // space permissions. Do not add a stricter space-role check here.
    if (write) {
      this.assertWrite(actor);
      await this.pageAccess.validateCanEdit(page, actor.user, trx);
    } else await this.pageAccess.validateCanView(page, actor.user, trx);
    return page;
  }
}
