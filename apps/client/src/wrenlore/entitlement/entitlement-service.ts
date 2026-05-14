import api from "@/lib/api-client";
import { WrenLoreEntitlements } from "./entitlement.types";

export async function getEntitlements(): Promise<WrenLoreEntitlements> {
  const req = await api.post<WrenLoreEntitlements>("/workspace/entitlements");
  return req.data;
}
