import { Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row";
import { ISpace } from "@/features/space/types/space.types";
import { updateSpace } from "@/features/space/services/space-service";
import { queryClient } from "@/main";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";

export default function SpacePublicSharingToggle({ space }: { space: ISpace }) {
  const { t } = useTranslation();
  const workspace = useAtomValue(workspaceAtom);
  const workspaceSharingDisabled = workspace?.settings?.sharing?.disabled === true;
  const checked = workspaceSharingDisabled || space?.settings?.sharing?.disabled === true;

  async function handleChange(value: boolean) {
    if (workspaceSharingDisabled) {
      return;
    }

    try {
      await updateSpace({ spaceId: space.id, disablePublicSharing: value } as any);
      await queryClient.invalidateQueries({ queryKey: ["space", space.id] });
      notifications.show({ message: t("Space sharing settings updated") });
    } catch (err) {
      notifications.show({ color: "red", message: t("Failed to update space sharing settings") });
    }
  }

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Disable public sharing for this space")}</Text>
        <Text size="sm" c="dimmed">
          {workspaceSharingDisabled
            ? t("Public sharing is disabled at the workspace level, so this space cannot enable public sharing.")
            : t("Prevent pages in this space from being shared publicly.")}
        </Text>
      </ResponsiveSettingsContent>
      <ResponsiveSettingsControl>
        <Switch
          checked={checked}
          disabled={workspaceSharingDisabled}
          onChange={(event) => handleChange(event.currentTarget.checked)}
        />
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}
