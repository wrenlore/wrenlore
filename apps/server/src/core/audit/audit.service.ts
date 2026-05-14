import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';
import { AuditLogsDto } from './dto/audit.dto';

@Injectable()
export class AuditQueryService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async getAuditLogs(workspaceId: string, dto: AuditLogsDto) {
    const limit = dto.limit ?? 50;

    let query = this.db
      .selectFrom('audit')
      .leftJoin('users as actor', 'actor.id', 'audit.actorId')
      .selectAll('audit')
      .select([
        'actor.id as actorRefId',
        'actor.name as actorName',
        'actor.email as actorEmail',
        'actor.avatarUrl as actorAvatarUrl',
      ])
      .where('audit.workspaceId', '=', workspaceId)
      .orderBy('audit.id', 'desc');

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
    const prevCursor = hasPrevPage && pagedRows.length > 0 ? pagedRows[0].id : null;

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
