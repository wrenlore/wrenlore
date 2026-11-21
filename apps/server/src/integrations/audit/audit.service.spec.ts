import { Logger } from '@nestjs/common';
import {
  DatabaseAuditService,
  AuditLogContext,
} from './audit.service';
import { AUDIT_CONTEXT_KEY } from '../../common/middlewares/audit-context.middleware';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';

describe('DatabaseAuditService (#151)', () => {
  let inserted: Record<string, unknown>[];
  let db: any;
  let cls: { get: jest.Mock; set: jest.Mock };
  let service: DatabaseAuditService;
  let warn: jest.SpyInstance;

  const context: AuditLogContext = {
    workspaceId: 'ws-id',
    actorId: 'leo-id',
    actorType: 'user',
    ipAddress: '203.0.113.9',
  };

  beforeEach(() => {
    inserted = [];
    db = {
      insertInto: () => ({
        values: (rows: Record<string, unknown>[]) => ({
          execute: async () => {
            inserted.push(...rows);
          },
        }),
      }),
    };
    cls = { get: jest.fn(() => context), set: jest.fn() };
    service = new DatabaseAuditService(db, cls as any);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('writes the event with request context', async () => {
    await service.log({
      event: AuditEvent.PAGE_TRASHED,
      resourceType: AuditResource.PAGE,
      resourceId: 'page-id',
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      workspaceId: 'ws-id',
      actorId: 'leo-id',
      actorType: 'user',
      event: 'page.trashed',
      ipAddress: '203.0.113.9',
    });
  });

  it('skips excluded events without inserting', async () => {
    await service.log({
      event: AuditEvent.PAGE_CREATED,
      resourceType: AuditResource.PAGE,
    });

    expect(inserted).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns instead of silently dropping events without context', async () => {
    cls.get.mockReturnValue(undefined);

    await service.log({
      event: AuditEvent.PAGE_TRASHED,
      resourceType: AuditResource.PAGE,
    });

    expect(inserted).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no workspace context'),
    );
  });

  it('never lets a failed insert break the request path', async () => {
    db.insertInto = () => {
      throw new Error('db down');
    };

    await expect(
      service.log({
        event: AuditEvent.PAGE_TRASHED,
        resourceType: AuditResource.PAGE,
      }),
    ).resolves.toBeUndefined();
  });
});
