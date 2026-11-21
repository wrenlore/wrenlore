import { ForbiddenException } from '@nestjs/common';
import { AuditQueryService } from './audit.service';
import { SpaceMemberRepo } from '@wrenlore/db/repos/space/space-member.repo';
import { User, Workspace } from '@wrenlore/db/types/entity.types';

type WhereCall = { col: string; op: string; val: unknown };

function fakeDb(rows: Record<string, unknown>[], wheres: WhereCall[]) {
  const query: any = {
    leftJoin: () => query,
    selectAll: () => query,
    select: () => query,
    where: (col: string, op: string, val: unknown) => {
      wheres.push({ col, op, val });
      return query;
    },
    orderBy: () => query,
    limit: () => query,
    execute: async () => rows,
  };
  return { selectFrom: () => query } as any;
}

const auditRow = {
  id: '01a1-event-0000-0000-000000000001',
  workspaceId: 'ws-id',
  actorId: 'actor-id',
  actorType: 'user',
  event: 'page.trashed',
  resourceType: 'page',
  resourceId: 'page-id',
  spaceId: 'space-a',
  changes: null,
  metadata: null,
  ipAddress: null,
  createdAt: new Date(),
  actorRefId: null,
  actorName: null,
  actorEmail: null,
  actorAvatarUrl: null,
};

describe('AuditQueryService visibility (#151)', () => {
  const user = { id: 'leo-id' } as unknown as User;
  const workspace = { id: 'ws-id' } as unknown as Workspace;
  let spaceMembers: { getUserAdminSpaceIds: jest.Mock };

  beforeEach(() => {
    spaceMembers = { getUserAdminSpaceIds: jest.fn() };
  });

  describe('getAccess', () => {
    it('grants workspace scope to workspace audit managers', async () => {
      const service = new AuditQueryService(fakeDb([], []), spaceMembers as any);
      await expect(
        service.getAccess(user, workspace, true),
      ).resolves.toEqual({ visible: true, scope: 'workspace' });
      expect(spaceMembers.getUserAdminSpaceIds).not.toHaveBeenCalled();
    });

    it('grants space scope to space administrators', async () => {
      spaceMembers.getUserAdminSpaceIds.mockResolvedValue(['space-a']);
      const service = new AuditQueryService(fakeDb([], []), spaceMembers as any);
      await expect(
        service.getAccess(user, workspace, false),
      ).resolves.toEqual({ visible: true, scope: 'spaces' });
      expect(spaceMembers.getUserAdminSpaceIds).toHaveBeenCalledWith(
        'leo-id',
        'ws-id',
      );
    });

    it('hides audit from users without any access', async () => {
      spaceMembers.getUserAdminSpaceIds.mockResolvedValue([]);
      const service = new AuditQueryService(fakeDb([], []), spaceMembers as any);
      await expect(
        service.getAccess(user, workspace, false),
      ).resolves.toEqual({ visible: false, scope: 'none' });
    });
  });

  describe('resolveVisibility', () => {
    it('denies queries for users without access', async () => {
      spaceMembers.getUserAdminSpaceIds.mockResolvedValue([]);
      const service = new AuditQueryService(fakeDb([], []), spaceMembers as any);
      await expect(
        service.resolveVisibility(user, workspace, false),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getAuditLogs', () => {
    it('always constrains results to the requesting workspace', async () => {
      const wheres: WhereCall[] = [];
      const service = new AuditQueryService(
        fakeDb([auditRow], wheres),
        spaceMembers as any,
      );
      await service.getAuditLogs(user, workspace, {}, { scope: 'workspace' });
      expect(wheres).toContainEqual({
        col: 'audit.workspaceId',
        op: '=',
        val: 'ws-id',
      });
      expect(
        wheres.some((w) => w.col === 'audit.spaceId' && w.op === 'in'),
      ).toBe(false);
    });

    it('restricts space-scoped callers to their administered spaces', async () => {
      const wheres: WhereCall[] = [];
      const service = new AuditQueryService(
        fakeDb([auditRow], wheres),
        spaceMembers as any,
      );
      await service.getAuditLogs(user, workspace, {}, {
        scope: 'spaces',
        spaceIds: ['space-a', 'space-b'],
      });
      expect(wheres).toContainEqual({
        col: 'audit.spaceId',
        op: 'in',
        val: ['space-a', 'space-b'],
      });
    });

    it('rejects a spaceId filter outside the caller scope', async () => {
      const service = new AuditQueryService(fakeDb([], []), spaceMembers as any);
      await expect(
        service.getAuditLogs(
          user,
          workspace,
          { spaceId: 'space-other' },
          { scope: 'spaces', spaceIds: ['space-a'] },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('applies the space scope together with other filters', async () => {
      const wheres: WhereCall[] = [];
      const service = new AuditQueryService(
        fakeDb([auditRow], wheres),
        spaceMembers as any,
      );
      await service.getAuditLogs(
        user,
        workspace,
        { event: 'page.trashed', actorId: 'actor-id' },
        { scope: 'spaces', spaceIds: ['space-a'] },
      );
      expect(wheres).toContainEqual({
        col: 'audit.spaceId',
        op: 'in',
        val: ['space-a'],
      });
      expect(wheres).toContainEqual({
        col: 'audit.event',
        op: '=',
        val: 'page.trashed',
      });
      expect(wheres).toContainEqual({
        col: 'audit.actorId',
        op: '=',
        val: 'actor-id',
      });
    });
  });
});
