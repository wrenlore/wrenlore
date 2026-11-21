import { Test, TestingModule } from '@nestjs/testing';
import { UserRepo } from '@wrenlore/db/repos/user/user.repo';
import { WorkspaceRepo } from '@wrenlore/db/repos/workspace/workspace.repo';
import { PageRepo } from '@wrenlore/db/repos/page/page.repo';
import { PageAccessService } from '../page/page-access/page-access.service';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import { AgentTokenService } from './agent-token.service';
import { User, Workspace } from '@wrenlore/db/types/entity.types';

type CapturedInsert = { table: string; values: Record<string, any> };

function buildFakeDb(captured: CapturedInsert[]) {
  const insertQuery = (values: Record<string, any>) => ({
    returning: (fields?: readonly string[]) => ({
      executeTakeFirstOrThrow: async () =>
        fields
          ? Object.fromEntries(
              fields.map((f) => [
                f,
                f === 'createdAt' ? new Date() : values[f],
              ]),
            )
          : { ...values, createdAt: new Date() },
    }),
    execute: async () => [],
  });
  const updateChain = {
    where: () => updateChain,
    returning: () => ({
      executeTakeFirst: async () => ({
        id: 'token-id',
        agentName: 'Francis',
      }),
    }),
  };
  const trx = {
    insertInto: (table: string) => ({
      values: (values: Record<string, any>) => {
        captured.push({ table, values });
        return insertQuery(values);
      },
    }),
    updateTable: () => ({
      set: () => updateChain,
    }),
  };
  return {
    transaction: () => ({
      execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx),
    }),
  };
}

describe('AgentTokenService audit attribution (#149)', () => {
  let service: AgentTokenService;
  let captured: CapturedInsert[];

  const leo = {
    id: 'leo-id',
    name: 'Leo',
    workspaceId: 'ws-id',
    role: 'member',
  } as unknown as User;
  const workspace = {
    id: 'ws-id',
    settings: { ai: { mcp: true } },
  } as unknown as Workspace;

  beforeEach(async () => {
    captured = [];
    const db = buildFakeDb(captured);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentTokenService,
        { provide: 'KyselyModuleConnectionToken', useValue: db },
        { provide: UserRepo, useValue: {} },
        { provide: WorkspaceRepo, useValue: {} },
        { provide: PageRepo, useValue: {} },
        { provide: PageAccessService, useValue: {} },
        { provide: SpaceAbilityFactory, useValue: {} },
      ],
    }).compile();

    service = module.get(AgentTokenService);
  });

  function auditRow(): Record<string, any> {
    const row = captured.find((entry) => entry.table === 'audit');
    if (!row) throw new Error('no audit row captured');
    return row.values;
  }

  it('attributes manual token creation to the user, not the agent', async () => {
    const result = await service.create(leo, workspace, {
      name: 'Laptop agent',
      agentName: 'Francis',
      access: 'read',
      spaceIds: null,
      expiresAt: null,
    });

    expect(result.token).toMatch(/^wrl_/);
    const audit = auditRow();
    expect(audit.event).toBe('agent.token_created');
    expect(audit.actorId).toBe('leo-id');
    expect(audit.actorType).toBe('user');
    // The configured agent is recorded as connection information only.
    expect(audit.metadata.agentName).toBe('Francis');
    expect(audit.metadata.managedConnection).toBe(true);
    expect(audit.metadata.viaAgent).toBeUndefined();
  });

  it('attributes manual token revocation to the user, not the agent', async () => {
    await service.revoke(leo, '00000000-0000-4000-8000-000000000000');

    const audit = auditRow();
    expect(audit.event).toBe('agent.token_revoked');
    expect(audit.actorId).toBe('leo-id');
    expect(audit.actorType).toBe('user');
    expect(audit.metadata.agentName).toBe('Francis');
    expect(audit.metadata.managedConnection).toBe(true);
    expect(audit.metadata.viaAgent).toBeUndefined();
  });

  it('never persists the token secret in the audit row or returned row', async () => {
    const result = await service.create(leo, workspace, {
      name: 'Laptop agent',
      agentName: 'Francis',
      access: 'read',
      spaceIds: null,
      expiresAt: null,
    });

    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain(result.token);
    expect(serialized).not.toContain((result as any).tokenHash ?? '\u0000');
    expect((result as any).tokenHash).toBeUndefined();
  });
});
