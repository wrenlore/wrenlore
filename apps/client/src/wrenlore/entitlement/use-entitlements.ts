import { useQuery } from "@tanstack/react-query";
import { getEntitlements } from "./entitlement-service";

export function useEntitlements() {
  return useQuery({
    queryKey: ["wrenlore-entitlements"],
    queryFn: getEntitlements,
  });
}
