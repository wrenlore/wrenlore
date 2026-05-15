import { Alert, Box, Group, Stack, Text } from "@mantine/core";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";

export function MfaSettings() {
  const { t } = useTranslation();
  const currentUser = useAtomValue(currentUserAtom);
  const required = currentUser?.mfaPolicy?.requireForLocalAccounts === true;
  const enrolled = Boolean(currentUser?.user?.mfa?.enabledAt);

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap" gap="xl">
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Text size="md">{t("Multi-factor authentication")}</Text>
          <Text size="sm" c="dimmed">
            {t(
              "Native MFA for local password accounts is controlled by an administrator.",
            )}
          </Text>
        </Box>
      </Group>

      <Alert color={required ? "blue" : "gray"} variant="light">
        {required
          ? enrolled
            ? t("MFA is required for your account and is already set up.")
            : t("MFA is required for your account. You will be prompted to set it up at login.")
          : t("MFA is currently disabled by an administrator.")}
      </Alert>
    </Stack>
  );
}
