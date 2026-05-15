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
  const requireForLocalAccounts = data?.requireForLocalAccounts === true;
  const controlsDisabled = isLoading || mutation.isPending;

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Require native MFA for local password users")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "When enabled, every local password user must set up MFA and complete an MFA challenge at login.",
          )}
        </Text>
      </ResponsiveSettingsContent>
      <ResponsiveSettingsControl>
        <Switch
          checked={requireForLocalAccounts}
          disabled={controlsDisabled}
          onChange={(event) =>
            mutation.mutate({
              requireForLocalAccounts: event.currentTarget.checked,
            })
          }
        />
      </ResponsiveSettingsControl>
    </ResponsiveSettingsRow>
  );
}
