import { Outlet } from "react-router";
import ShareShell from "@/features/share/components/share-shell.tsx";

export default function ShareLayout() {
  return (
    <ShareShell>
      <Outlet />
    </ShareShell>
  );
}
