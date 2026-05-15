import { Switch, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row";
import {
  useMfaPolicyQuery,
  useUpdateMfaPolicyMutation,
} from "@/features/workspace/queries/workspace-query";

export default function EnforceMfa() {
  const { t } = useTranslation();
  const { data, isLoading } = useMfaPolicyQuery();
  const mutation = useUpdateMfaPolicyMutation();
  const enabled = data?.enabled !== false;
  const requireForLocalAccounts = data?.requireForLocalAccounts === true;
  const controlsDisabled = isLoading || mutation.isPending;

  return (
    <>
      <ResponsiveSettingsRow>
        <ResponsiveSettingsContent>
          <Text size="md">{t("Enable native MFA")}</Text>
          <Text size="sm" c="dimmed">
            {enabled
              ? t("Users may enable MFA for their own account.")
              : t(
                  "MFA is disabled globally. Users will not be asked for MFA at login.",
                )}
          </Text>
        </ResponsiveSettingsContent>
        <ResponsiveSettingsControl>
          <Switch
            checked={enabled}
            disabled={controlsDisabled}
            onChange={(event) =>
              mutation.mutate({
                enabled: event.currentTarget.checked,
                requireForLocalAccounts,
              })
            }
          />
        </ResponsiveSettingsControl>
      </ResponsiveSettingsRow>

      <ResponsiveSettingsRow>
        <ResponsiveSettingsContent>
          <Text size="md">{t("Require MFA setup for local password users")}</Text>
          <Text size="sm" c="dimmed">
            {t(
              "When enabled, local password users without MFA must set it up before continuing.",
            )}
          </Text>
        </ResponsiveSettingsContent>
        <ResponsiveSettingsControl>
          <Switch
            checked={requireForLocalAccounts}
            disabled={controlsDisabled || !enabled}
            onChange={(event) =>
              mutation.mutate({
                enabled,
                requireForLocalAccounts: event.currentTarget.checked,
              })
            }
          />
        </ResponsiveSettingsControl>
      </ResponsiveSettingsRow>
    </>
  );
}
