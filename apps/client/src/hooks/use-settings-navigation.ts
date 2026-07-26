import { settingsOriginAtom } from "@/components/settings/atoms/settings-origin-atom";
import { useAtomValue } from "jotai";
import { useNavigate } from "react-router";

export function useSettingsNavigation() {
  const navigate = useNavigate();
  const origin = useAtomValue(settingsOriginAtom);

  const goBack = () => {
    navigate(origin ?? "/home", { replace: true });
  };

  return { goBack };
}