import { IAuditLog } from "@/wrenlore/audit/types/audit.types";

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
  const viaAgent = item.metadata?.viaAgent === true && agentName !== null;

  return {
    actorLabel: item.actor?.name || item.actorType || "System",
    viaAgentName: viaAgent ? agentName : null,
    managedAgentName: viaAgent || !agentName ? null : agentName,
  };
}
