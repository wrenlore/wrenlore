/**
 * Audit attribution helpers.
 *
 * "User, via Agent" attribution is reserved for actions actually performed
 * with agent (MCP token) credentials. Manual management of an agent
 * connection (creating or revoking a token) is performed by the human user
 * alone; the configured agent name is resource information, not an actor.
 * See issue #149.
 */
import type { JsonValue } from '@wrenlore/db/types/db';

export type AgentAuditActor = {
  agentName: string;
  tokenId: string;
};

/**
 * Metadata for audit events performed through an agent token. The
 * `viaAgent` marker is what clients use to render "User, via Agent".
 */
export function agentPerformedAuditMetadata(
  actor: AgentAuditActor,
  extra: Record<string, JsonValue> = {},
): Record<string, JsonValue> {
  return {
    agentName: actor.agentName,
    tokenId: actor.tokenId,
    viaAgent: true,
    ...extra,
  };
}

/**
 * Metadata for audit events where a user manually manages an agent
 * connection (token created/revoked). The agent name describes the
 * connection being managed and must never be rendered as agent attribution.
 */
export function agentConnectionManagedAuditMetadata(
  agentName: string,
  extra: Record<string, JsonValue> = {},
): Record<string, JsonValue> {
  return {
    agentName,
    managedConnection: true,
    ...extra,
  };
}
