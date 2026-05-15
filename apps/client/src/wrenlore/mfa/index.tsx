import {
  Alert,
  Box,
  Button,
  Code,
  CopyButton,
  Group,
  Image,
  List,
  Modal,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconCopy, IconKey, IconRefresh, IconShieldCheck, IconShieldOff } from "@tabler/icons-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import {
  confirmMfaSetup,
  disableMfa,
  regenerateMfaRecoveryCodes,
  startMfaSetup,
} from "@/features/auth/services/auth-service";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { CURRENT_USER_QUERY_KEY } from "@/features/user/hooks/use-current-user";

type SetupData = Awaited<ReturnType<typeof startMfaSetup>>;

export function MfaSettings() {
  const { t } = useTranslation();
  const currentUser = useAtomValue(currentUserAtom);
  const enabled = Boolean(currentUser?.user?.mfa?.enabledAt);
  const [setupOpened, setupModal] = useDisclosure(false);
  const [disableOpened, disableModal] = useDisclosure(false);
  const [recoveryOpened, recoveryModal] = useDisclosure(false);

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap" gap="xl">
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Text size="md">{t("Multi-factor authentication")}</Text>
          <Text size="sm" c="dimmed">
            {t(
              "Protect local email and password sign-ins with an authenticator app. SSO users should manage MFA at their identity provider.",
            )}
          </Text>
        </Box>

        {enabled ? (
          <Group gap="xs" wrap="nowrap">
            <Button
              variant="default"
              leftSection={<IconRefresh size={16} />}
              onClick={recoveryModal.open}
            >
              {t("Recovery codes")}
            </Button>
            <Button
              variant="default"
              color="red"
              leftSection={<IconShieldOff size={16} />}
              onClick={disableModal.open}
            >
              {t("Disable")}
            </Button>
          </Group>
        ) : (
          <Button
            variant="default"
            leftSection={<IconShieldCheck size={16} />}
            onClick={setupModal.open}
          >
            {t("Enable")}
          </Button>
        )}
      </Group>

      <MfaSetupModal opened={setupOpened} onClose={setupModal.close} />
      <DisableMfaModal opened={disableOpened} onClose={disableModal.close} />
      <RegenerateRecoveryCodesModal
        opened={recoveryOpened}
        onClose={recoveryModal.close}
      />
    </Stack>
  );
}

function MfaSetupModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [token, setToken] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const startMutation = useMutation({
    mutationFn: startMfaSetup,
    onSuccess: setSetup,
    onError: (err: any) => {
      notifications.show({
        color: "red",
        message: err.response?.data?.message ?? t("Failed to start MFA setup"),
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: confirmMfaSetup,
    onSuccess: async (data) => {
      setRecoveryCodes(data.recoveryCodes);
      await queryClient.invalidateQueries({ queryKey: CURRENT_USER_QUERY_KEY });
      notifications.show({ message: t("Multi-factor authentication enabled") });
    },
    onError: (err: any) => {
      notifications.show({
        color: "red",
        message: err.response?.data?.message ?? t("Invalid authentication code"),
      });
    },
  });

  useEffect(() => {
    if (opened) {
      setSetup(null);
      setQrDataUrl("");
      setToken("");
      setRecoveryCodes([]);
      startMutation.mutate();
    }
  }, [opened]);

  useEffect(() => {
    if (!setup?.uri) return;
    QRCode.toDataURL(setup.uri, { margin: 1, width: 180 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [setup?.uri]);

  const close = () => {
    onClose();
    setSetup(null);
    setRecoveryCodes([]);
    setToken("");
  };

  return (
    <Modal opened={opened} onClose={close} title={t("Enable MFA")} centered>
      {recoveryCodes.length > 0 ? (
        <RecoveryCodesView
          recoveryCodes={recoveryCodes}
          description={t(
            "Save these recovery codes now. They are shown only once and can be used if you lose access to your authenticator app.",
          )}
          onDone={close}
        />
      ) : (
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {t(
              "Scan the QR code with an authenticator app, then enter the 6-digit code to finish setup.",
            )}
          </Text>

          {qrDataUrl && (
            <Image
              src={qrDataUrl}
              alt={t("Authenticator QR code")}
              w={180}
              h={180}
              fit="contain"
            />
          )}

          {setup?.secret && (
            <Box>
              <Text size="sm" fw={500} mb={4}>
                {t("Manual setup key")}
              </Text>
              <Group gap="xs">
                <Code style={{ wordBreak: "break-all" }}>{setup.secret}</Code>
                <CopyButton value={setup.secret}>
                  {({ copied, copy }) => (
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconCopy size={14} />}
                      onClick={copy}
                    >
                      {copied ? t("Copied") : t("Copy")}
                    </Button>
                  )}
                </CopyButton>
              </Group>
            </Box>
          )}

          <TextInput
            label={t("Authentication code")}
            placeholder="123456"
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
            maxLength={12}
            inputMode="numeric"
            variant="filled"
          />

          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {t("Cancel")}
            </Button>
            <Button
              onClick={() => confirmMutation.mutate({ token })}
              loading={confirmMutation.isPending}
              disabled={!setup || token.trim().length === 0}
            >
              {t("Confirm")}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function DisableMfaModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");

  const mutation = useMutation({
    mutationFn: disableMfa,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CURRENT_USER_QUERY_KEY });
      notifications.show({ message: t("Multi-factor authentication disabled") });
      setCurrentPassword("");
      onClose();
    },
    onError: (err: any) => {
      notifications.show({
        color: "red",
        message: err.response?.data?.message ?? t("Failed to disable MFA"),
      });
    },
  });

  return (
    <Modal opened={opened} onClose={onClose} title={t("Disable MFA")} centered>
      <Stack gap="md">
        <Alert color="red" variant="light" icon={<IconShieldOff size={16} />}>
          {t(
            "Disabling MFA removes the extra check from local password sign-ins.",
          )}
        </Alert>
        <PasswordInput
          label={t("Current password")}
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.currentTarget.value)}
          variant="filled"
          data-autofocus
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            color="red"
            onClick={() => mutation.mutate({ currentPassword })}
            loading={mutation.isPending}
            disabled={currentPassword.length === 0}
          >
            {t("Disable MFA")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function RegenerateRecoveryCodesModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: regenerateMfaRecoveryCodes,
    onSuccess: async (data) => {
      setRecoveryCodes(data.recoveryCodes);
      await queryClient.invalidateQueries({ queryKey: CURRENT_USER_QUERY_KEY });
      notifications.show({ message: t("Recovery codes regenerated") });
    },
    onError: (err: any) => {
      notifications.show({
        color: "red",
        message:
          err.response?.data?.message ?? t("Failed to regenerate recovery codes"),
      });
    },
  });

  const close = () => {
    setCurrentPassword("");
    setRecoveryCodes([]);
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={t("Regenerate recovery codes")}
      centered
    >
      {recoveryCodes.length > 0 ? (
        <RecoveryCodesView
          recoveryCodes={recoveryCodes}
          description={t(
            "Save these new recovery codes now. Previously unused recovery codes no longer work.",
          )}
          onDone={close}
        />
      ) : (
        <Stack gap="md">
          <Alert color="yellow" variant="light" icon={<IconKey size={16} />}>
            {t(
              "Regenerating recovery codes invalidates any old unused recovery codes.",
            )}
          </Alert>
          <PasswordInput
            label={t("Current password")}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.currentTarget.value)}
            variant="filled"
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {t("Cancel")}
            </Button>
            <Button
              onClick={() => mutation.mutate({ currentPassword })}
              loading={mutation.isPending}
              disabled={currentPassword.length === 0}
            >
              {t("Regenerate")}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function RecoveryCodesView({
  recoveryCodes,
  description,
  onDone,
}: {
  recoveryCodes: string[];
  description: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const allCodes = recoveryCodes.join("\n");

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {description}
      </Text>
      <List spacing={4} size="sm">
        {recoveryCodes.map((code) => (
          <List.Item key={code}>
            <Code>{code}</Code>
          </List.Item>
        ))}
      </List>
      <Group justify="space-between">
        <CopyButton value={allCodes}>
          {({ copied, copy }) => (
            <Button
              variant="default"
              leftSection={<IconCopy size={16} />}
              onClick={copy}
            >
              {copied ? t("Copied") : t("Copy codes")}
            </Button>
          )}
        </CopyButton>
        <Button onClick={onDone}>{t("Done")}</Button>
      </Group>
    </Stack>
  );
}
