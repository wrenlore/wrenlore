import { Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";
import { updateWorkspace } from "@/features/workspace/services/workspace-service";

export default function DisablePublicSharing() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const checked = workspace?.settings?.sharing?.disabled === true;

  async function handleChange(value: boolean) {
    try {
      const updated = await updateWorkspace({ disablePublicSharing: value } as any);
      setWorkspace(updated);
      notifications.show({ message: t("Public sharing settings updated") });
    } catch (err) {
      notifications.show({ color: "red", message: t("Failed to update public sharing settings") });
    }
  }

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Disable public sharing")}</Text>
        <Text size="sm" c="dimmed">
          {t("Prevent public page links from being created or accessed for this workspace.")}
        </Text>
      </ResponsiveSettingsContent>
      <ResponsiveSettingsControl>
        <Switch checked={checked} onChange={(event) => handleChange(event.currentTarget.checked)} />
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}
