import { InjectKysely } from 'nestjs-kysely';
import { Injectable, Logger } from '@nestjs/common';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';
import {
  AuditLogPayload,
  ActorType,
  EXCLUDED_AUDIT_EVENTS,
} from '../../common/events/audit-events';
import {
  AUDIT_CONTEXT_KEY,
  AuditContext,
} from '../../common/middlewares/audit-context.middleware';
import { ClsService } from 'nestjs-cls';

export type AuditLogContext = {
  workspaceId: string;
  actorId?: string;
  actorType?: ActorType;
  ipAddress?: string;
  userAgent?: string;
};

export type IAuditService = {
  log(payload: AuditLogPayload): void | Promise<void>;
  logWithContext(
    payload: AuditLogPayload,
    context: AuditLogContext,
  ): void | Promise<void>;
  logBatchWithContext(
    payloads: AuditLogPayload[],
    context: AuditLogContext,
  ): void | Promise<void>;
  setActorId(actorId: string): void;
  setActorType(actorType: ActorType): void;
  updateRetention(
    workspaceId: string,
    retentionDays: number,
  ): void | Promise<void>;
};

export const AUDIT_SERVICE = Symbol('AUDIT_SERVICE');

@Injectable()
export class DatabaseAuditService implements IAuditService {
  private readonly logger = new Logger(DatabaseAuditService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly cls: ClsService,
  ) {}

  async log(payload: AuditLogPayload): Promise<void> {
    if (EXCLUDED_AUDIT_EVENTS.has(payload.event)) {
      return;
    }

    const context = this.cls.get<AuditContext>(AUDIT_CONTEXT_KEY);
    if (!context?.workspaceId) {
      return;
    }

    await this.logWithContext(payload, {
      workspaceId: context.workspaceId,
      actorId: context.actorId ?? undefined,
      actorType: context.actorType ?? 'user',
      ipAddress: context.ipAddress ?? undefined,
    });
  }

  async logWithContext(
    payload: AuditLogPayload,
    context: AuditLogContext,
  ): Promise<void> {
    await this.logBatchWithContext([payload], context);
  }

  async logBatchWithContext(
    payloads: AuditLogPayload[],
    context: AuditLogContext,
  ): Promise<void> {
    if (!context.workspaceId || payloads.length === 0) {
      return;
    }

    const rows = payloads
      .filter((payload) => !EXCLUDED_AUDIT_EVENTS.has(payload.event))
      .map((payload) => ({
        workspaceId: context.workspaceId,
        actorId: context.actorId ?? null,
        actorType: context.actorType ?? 'user',
        event: payload.event,
        resourceType: payload.resourceType,
        resourceId: payload.resourceId ?? null,
        spaceId: payload.spaceId ?? null,
        changes: payload.changes ?? null,
        metadata: payload.metadata ?? null,
        ipAddress: context.ipAddress ?? null,
      }));

    if (rows.length === 0) {
      return;
    }

    try {
      await this.db.insertInto('audit').values(rows).execute();
    } catch (err) {
      this.logger.warn('Failed to write audit log');
      this.logger.debug(err);
    }
  }

  setActorId(actorId: string): void {
    const context = this.cls.get<AuditContext>(AUDIT_CONTEXT_KEY);
    if (!context) {
      return;
    }
    context.actorId = actorId;
    this.cls.set(AUDIT_CONTEXT_KEY, context);
  }

  setActorType(actorType: ActorType): void {
    const context = this.cls.get<AuditContext>(AUDIT_CONTEXT_KEY);
    if (!context) {
      return;
    }
    context.actorType = actorType;
    this.cls.set(AUDIT_CONTEXT_KEY, context);
  }

  async updateRetention(
    workspaceId: string,
    retentionDays: number,
  ): Promise<void> {
    await this.db
      .updateTable('workspaces')
      .set({
        auditRetentionDays: retentionDays,
      })
      .where('id', '=', workspaceId)
      .execute();
  }
}
