import { NumberInput, Text } from "@mantine/core";
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

export default function TrashRetention() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const value = workspace?.trashRetentionDays ?? 30;

  async function handleChange(nextValue: string | number) {
    const days = Number(nextValue);
    if (!Number.isFinite(days)) return;
    try {
      const updated = await updateWorkspace({ trashRetentionDays: days } as any);
      setWorkspace(updated);
      notifications.show({ message: t("Trash retention updated") });
    } catch (err) {
      notifications.show({ color: "red", message: t("Failed to update trash retention") });
    }
  }

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Trash retention")}</Text>
        <Text size="sm" c="dimmed">
          {t("Number of days deleted pages stay in trash before cleanup.")}
        </Text>
      </ResponsiveSettingsContent>
      <ResponsiveSettingsControl>
        <NumberInput min={1} max={365} value={value} onChange={handleChange} w={120} />
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}
