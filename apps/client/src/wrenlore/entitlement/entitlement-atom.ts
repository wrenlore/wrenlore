import { atom } from "jotai";
import { WrenLoreEntitlements } from "./entitlement.types";

export const entitlementAtom = atom<WrenLoreEntitlements | null>(null);
