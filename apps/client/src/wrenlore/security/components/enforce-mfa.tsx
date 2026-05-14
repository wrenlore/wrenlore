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
  const checked = data?.requireForLocalAccounts === true;

  return (
    <ResponsiveSettingsRow>
      <ResponsiveSettingsContent>
        <Text size="md">{t("Require MFA for local password accounts")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "When enabled, local email/password users must set up MFA before normal app use. SSO users continue to use MFA at their identity provider.",
          )}
        </Text>
      </ResponsiveSettingsContent>
      <ResponsiveSettingsControl>
        <Switch
          checked={checked}
          disabled={isLoading || mutation.isPending}
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
