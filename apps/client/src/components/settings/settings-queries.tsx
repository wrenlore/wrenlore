import { queryClient } from "@/main.tsx";
import { getSpaces } from "@/features/space/services/space-service.ts";
import { getGroups } from "@/features/group/services/group-service.ts";
import { QueryParams } from "@/lib/types.ts";
import { getWorkspaceMembers } from "@/features/workspace/services/workspace-service.ts";
import { getSsoProviders } from "@/features/auth/sso/service.ts";
import { getShares } from "@/features/share/services/share-service.ts";
import { getAuditLogs } from "@/wrenlore/audit/services/audit-service";

export const prefetchWorkspaceMembers = () => {
  const params: QueryParams = { limit: 100, query: "" };
  queryClient.prefetchQuery({
    queryKey: ["workspaceMembers", params],
    queryFn: () => getWorkspaceMembers(params),
  });
};

export const prefetchSpaces = () => {
  queryClient.prefetchQuery({
    queryKey: ["spaces", {}],
    queryFn: () => getSpaces({}),
  });
};

export const prefetchGroups = () => {
  queryClient.prefetchQuery({
    queryKey: ["groups", {}],
    queryFn: () => getGroups({}),
  });
};

export const prefetchSsoProviders = () => {
  queryClient.prefetchQuery({
    queryKey: ["sso-providers"],
    queryFn: () => getSsoProviders(),
  });
};

export const prefetchShares = () => {
  queryClient.prefetchQuery({
    queryKey: ["share-list", {}],
    queryFn: () => getShares({}),
  });
};

export const prefetchAuditLogs = () => {
  const params = { limit: 50 };
  queryClient.prefetchQuery({
    queryKey: ["audit-logs", params],
    queryFn: () => getAuditLogs(params),
  });
};
