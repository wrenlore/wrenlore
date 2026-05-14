import api from "@/lib/api-client";
import { IPagination } from "@/lib/types";
import { IAuditLog, IAuditLogParams } from "@/wrenlore/audit/types/audit.types";

export async function getAuditLogs(
  params: IAuditLogParams,
): Promise<IPagination<IAuditLog>> {
  const req = await api.post<IPagination<IAuditLog>>("/audit", params);
  return req.data;
}
