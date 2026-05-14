import { useQuery } from "@tanstack/react-query";
import { getAuditLogs } from "@/wrenlore/audit/services/audit-service";
import { IAuditLogParams } from "@/wrenlore/audit/types/audit.types";

export function useAuditLogs(params: IAuditLogParams) {
  return useQuery({
    queryKey: ["audit-logs", params],
    queryFn: () => getAuditLogs(params),
  });
}
