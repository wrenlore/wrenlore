import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';
import { User, Workspace } from '@wrenlore/db/types/entity.types';
import { SpaceMemberRepo } from '@wrenlore/db/repos/space/space-member.repo';
import { AuditLogsDto } from './dto/audit.dto';

/**
 * Server-side audit visibility (issue #151).
 *
 * - Workspace owners/admins (Manage Audit) see the whole workspace.
 * - Space administrators see only events scoped to spaces they administer.
 *   Workspace-level events (no spaceId) are not part of that scope.
 * - Everyone else has no audit access.
 *
 * The scope is applied to the query itself, so filters, pagination and
 * returned rows can never reveal activity outside the caller's scope.
 */
export type AuditVisibility =
  | { scope: 'workspace' }
  | { scope: 'spaces'; spaceIds: string[] };

@Injectable()
export class AuditQueryService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly spaceMembers: SpaceMemberRepo,
  ) {}

  async getAccess(
    user: User,
    workspace: Workspace,
    canManageWorkspaceAudit: boolean,
  ): Promise<{ visible: boolean; scope: 'workspace' | 'spaces' | 'none' }> {
    if (canManageWorkspaceAudit) {
      return { visible: true, scope: 'workspace' };
    }
    const spaceIds = await this.spaceMembers.getUserAdminSpaceIds(
      user.id,
      workspace.id,
    );
    return spaceIds.length > 0
      ? { visible: true, scope: 'spaces' }
      : { visible: false, scope: 'none' };
  }

  async resolveVisibility(
    user: User,
    workspace: Workspace,
    canManageWorkspaceAudit: boolean,
  ): Promise<AuditVisibility> {
    if (canManageWorkspaceAudit) {
      return { scope: 'workspace' };
    }
    const spaceIds = await this.spaceMembers.getUserAdminSpaceIds(
      user.id,
      workspace.id,
    );
    if (spaceIds.length === 0) {
      throw new ForbiddenException();
    }
    return { scope: 'spaces', spaceIds };
  }

  async getAuditLogs(
    user: User,
    workspace: Workspace,
    dto: AuditLogsDto,
    visibility: AuditVisibility,
  ) {
    const limit = dto.limit ?? 50;

    if (
      visibility.scope === 'spaces' &&
      dto.spaceId &&
      !visibility.spaceIds.includes(dto.spaceId)
    ) {
      throw new ForbiddenException();
    }

    let query = this.db
      .selectFrom('audit')
      .leftJoin(
        'users as actor',
        (join) =>
          join
            .onRef('actor.id', '=', 'audit.actorId')
            .onRef('actor.workspaceId', '=', 'audit.workspaceId'),
      )
      .selectAll('audit')
      .select([
        'actor.id as actorRefId',
        'actor.name as actorName',
        'actor.email as actorEmail',
        'actor.avatarUrl as actorAvatarUrl',
      ])
      .where('audit.workspaceId', '=', workspace.id)
      .orderBy('audit.id', 'desc');

    if (visibility.scope === 'spaces') {
      query = query.where('audit.spaceId', 'in', visibility.spaceIds);
    }

    if (dto.cursor) {
      query = query.where('audit.id', '<', dto.cursor);
    }
    if (dto.event) {
      query = query.where('audit.event', '=', dto.event);
    }
    if (dto.resourceType) {
      query = query.where('audit.resourceType', '=', dto.resourceType);
    }
    if (dto.actorId) {
      query = query.where('audit.actorId', '=', dto.actorId);
    }
    if (dto.spaceId) {
      query = query.where('audit.spaceId', '=', dto.spaceId);
    }
    if (dto.startDate) {
      query = query.where('audit.createdAt', '>=', new Date(dto.startDate));
    }
    if (dto.endDate) {
      query = query.where('audit.createdAt', '<=', new Date(dto.endDate));
    }

    const rows = await query.limit(limit + 1).execute();
    const hasNextPage = rows.length > limit;
    const pagedRows = hasNextPage ? rows.slice(0, limit) : rows;
    const hasPrevPage = !!dto.cursor;
    const nextCursor =
      hasNextPage && pagedRows.length > 0
        ? pagedRows[pagedRows.length - 1].id
        : null;
    const prevCursor =
      hasPrevPage && pagedRows.length > 0 ? pagedRows[0].id : null;

    return {
      items: pagedRows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        actorId: row.actorId ?? undefined,
        actorType: row.actorType,
        event: row.event,
        resourceType: row.resourceType,
        resourceId: row.resourceId ?? undefined,
        spaceId: row.spaceId ?? undefined,
        changes: row.changes ?? undefined,
        metadata: row.metadata ?? undefined,
        ipAddress: row.ipAddress ?? undefined,
        createdAt: row.createdAt,
        actor:
          row.actorRefId && row.actorName && row.actorEmail
            ? {
                id: row.actorRefId,
                name: row.actorName,
                email: row.actorEmail,
                avatarUrl: row.actorAvatarUrl ?? undefined,
              }
            : undefined,
      })),
      meta: {
        limit,
        hasNextPage,
        hasPrevPage,
        nextCursor,
        prevCursor,
      },
    };
  }

  async getRetention(workspaceId: string) {
    const workspace = await this.db
      .selectFrom('workspaces')
      .select(['auditRetentionDays'])
      .where('id', '=', workspaceId)
      .executeTakeFirstOrThrow();

    return {
      retentionDays: workspace.auditRetentionDays,
    };
  }
}
