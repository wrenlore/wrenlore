import {
  agentConnectionManagedAuditMetadata,
  agentPerformedAuditMetadata,
} from './agent-audit';

describe('agent audit metadata helpers (#149)', () => {
  it('marks actions performed with agent credentials as viaAgent', () => {
    const metadata = agentPerformedAuditMetadata(
      { agentName: 'Francis', tokenId: 'token-id' },
      { operationId: 'op-id' },
    );

    expect(metadata).toEqual({
      agentName: 'Francis',
      tokenId: 'token-id',
      viaAgent: true,
      operationId: 'op-id',
    });
  });

  it('marks manual connection management as not agent-performed', () => {
    const metadata = agentConnectionManagedAuditMetadata('Francis');

    expect(metadata.agentName).toBe('Francis');
    expect(metadata.managedConnection).toBe(true);
    expect(metadata.viaAgent).toBeUndefined();
  });
});
