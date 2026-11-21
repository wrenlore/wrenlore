import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAuditAttribution } from '../apps/client/src/wrenlore/audit/lib/audit-attribution';

function attribution(event: string, metadata: Record<string, unknown>) {
  return getAuditAttribution({
    event,
    actor: { name: 'Test User' },
    metadata,
  } as Parameters<typeof getAuditAttribution>[0]);
}

test('manual token management identifies the user and the managed connection', () => {
  for (const event of ['agent.token_created', 'agent.token_revoked']) {
    for (const metadata of [
      { agentName: 'Research Agent' },
      { agentName: 'Research Agent', managedConnection: true },
    ]) {
      assert.deepEqual(attribution(event, metadata), {
        actorLabel: 'Test User', viaAgentName: null, managedAgentName: 'Research Agent',
      });
    }
  }
});

test('existing agent actions retain their attribution without a data migration', () => {
  for (const event of ['agent.create_page', 'agent.add_comment', 'agent.page_edited']) {
    for (const metadata of [
      { agentName: 'Research Agent' },
      { agentName: 'Research Agent', viaAgent: true },
    ]) {
      assert.deepEqual(attribution(event, metadata), {
        actorLabel: 'Test User', viaAgentName: 'Research Agent', managedAgentName: null,
      });
    }
  }
});

test('unrelated metadata and explicit non-agent actions are not over-attributed', () => {
  assert.equal(attribution('page.updated', { agentName: 'Reference only' }).viaAgentName, null);
  assert.equal(attribution('page.updated', { agentName: 'Reference only' }).managedAgentName, null);
  assert.equal(attribution('agent.page_edited', { agentName: 'Research Agent', viaAgent: false }).viaAgentName, null);
});
