import type { IAuditLog } from "@/wrenlore/audit/types/audit.types";

const connectionEvents = new Set(["agent.token_created", "agent.token_revoked"]);
const legacyAgentEvents = new Set([
  "agent.create_page",
  "agent.add_comment",
  "agent.page_edited",
]);

export interface AuditAttribution {
  /** The user (or system) that performed the action. */
  actorLabel: string;
  /** Agent name, only when the action was actually performed with agent credentials. */
  viaAgentName: string | null;
  /** For manual token management: the agent the managed connection is configured for. */
  managedAgentName: string | null;
}

/**
 * Splits "who did it" from "which agent was involved". "User, via Agent"
 * is reserved for actions performed using an agent token (metadata.viaAgent).
 * Manual token management stores the configured agent name as information
 * about the connection, never as actor attribution (issue #149).
 */
export function getAuditAttribution(item: IAuditLog): AuditAttribution {
  const agentName =
    typeof item.metadata?.agentName === "string" ? item.metadata.agentName : null;
  // Existing agent-action records predate the explicit marker. Preserve their
  // attribution using the known event types; never reinterpret token management
  // or an arbitrary agentName field as an agent-performed action.
  const managedConnection = connectionEvents.has(item.event);
  const viaAgent =
    agentName !== null &&
    !managedConnection &&
    (item.metadata?.viaAgent === true ||
      (item.metadata?.viaAgent === undefined && legacyAgentEvents.has(item.event)));

  return {
    actorLabel: item.actor?.name || item.actorType || "System",
    viaAgentName: viaAgent ? agentName : null,
    managedAgentName: managedConnection ? agentName : null,
  };
}
