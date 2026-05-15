import {
  Anchor,
  Box,
  Button,
  Code,
  Container,
  Group,
  Image,
  List,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type React from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  completeMfaLogin,
  completeMfaRecoveryLogin,
  confirmMfaSetup,
  startMfaSetup,
} from "@/features/auth/services/auth-service";
import APP_ROUTE, { getPostLoginRedirect } from "@/lib/app-route";
import classes from "@/features/auth/components/auth.module.css";
import QRCode from "qrcode";
import { CopyButton } from "@/components/common/copy-button";

export function MfaChallengePage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [token, setToken] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const mfaToken =
    location.state?.mfaToken ?? sessionStorage.getItem("wrenlore:mfaToken");

  const totpMutation = useMutation({
    mutationFn: completeMfaLogin,
    onSuccess: () => {
      sessionStorage.removeItem("wrenlore:mfaToken");
      navigate(getPostLoginRedirect());
    },
    onError: (err: any) => {
      notifications.show({
        color: "red",
        message: err.response?.data?.message ?? t("Invalid authentication code"),
      });
    },
  });

  const recoveryMutation = useMutation({
    mutationFn: completeMfaRecoveryLogin,
    onSuccess: () => {
      sessionStorage.removeItem("wrenlore:mfaToken");
      navigate(getPostLoginRedirect());
    },
    onError: (err: any) => {
      notifications.show({
        color: "red",
        message: err.response?.data?.message ?? t("Invalid recovery code"),
      });
    },
  });

  if (!mfaToken) {
    return <Navigate to={APP_ROUTE.AUTH.LOGIN} replace />;
  }

  const loading = totpMutation.isPending || recoveryMutation.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    if (mode === "totp") {
      totpMutation.mutate({ mfaToken, token });
      return;
    }

    recoveryMutation.mutate({ mfaToken, recoveryCode });
  };

  return (
    <Container size={420} className={classes.container}>
      <Box p="xl" className={classes.containerBox}>
        <Title order={2} ta="center" fw={500} mb="xs">
          {t("Multi-factor authentication")}
        </Title>
        <Text size="sm" c="dimmed" ta="center" mb="lg">
          {t(
            "Enter a code from your authenticator app, or use a recovery code.",
          )}
        </Text>

        <form onSubmit={submit}>
          <Stack gap="md">
            <SegmentedControl
              fullWidth
              value={mode}
              onChange={(value) => setMode(value as "totp" | "recovery")}
              data={[
                { value: "totp", label: t("Authenticator") },
                { value: "recovery", label: t("Recovery code") },
              ]}
            />

            {mode === "totp" ? (
              <TextInput
                label={t("Authentication code")}
                placeholder="123456"
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
                maxLength={12}
                inputMode="numeric"
                variant="filled"
                data-autofocus
              />
            ) : (
              <PasswordInput
                label={t("Recovery code")}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={recoveryCode}
                onChange={(event) =>
                  setRecoveryCode(event.currentTarget.value)
                }
                variant="filled"
                data-autofocus
              />
            )}

            <Button
              type="submit"
              fullWidth
              loading={loading}
              disabled={
                mode === "totp"
                  ? token.trim().length === 0
                  : recoveryCode.trim().length === 0
              }
            >
              {t("Continue")}
            </Button>
          </Stack>
        </form>

        <Group justify="center" mt="md">
          <Anchor component={Link} to={APP_ROUTE.AUTH.LOGIN} size="sm">
            {t("Back to login")}
          </Anchor>
        </Group>
      </Box>
    </Container>
  );
}

export function MfaSetupRequiredPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [setup, setSetup] = useState<Awaited<ReturnType<typeof startMfaSetup>> | null>(null);
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
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes);
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
    startMutation.mutate();
  }, []);

  useEffect(() => {
    if (!setup?.uri) return;
    QRCode.toDataURL(setup.uri, { margin: 1, width: 180 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [setup?.uri]);

  const continueAfterSetup = () => navigate(getPostLoginRedirect());

  return (
    <Container size={460} className={classes.container}>
      <Box p="xl" className={classes.containerBox}>
        <Title order={2} ta="center" fw={500} mb="xs">
          {t("Set up multi-factor authentication")}
        </Title>
        <Text size="sm" c="dimmed" ta="center" mb="lg">
          {t(
            "Your workspace requires MFA for local password accounts. Add an authenticator app to continue.",
          )}
        </Text>

        {recoveryCodes.length > 0 ? (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t(
                "Save these recovery codes now. They are shown only once and can be used if you lose access to your authenticator app.",
              )}
            </Text>
            <List spacing={4} size="sm">
              {recoveryCodes.map((code) => (
                <List.Item key={code}>
                  <Code>{code}</Code>
                </List.Item>
              ))}
            </List>
            <Group justify="space-between">
              <CopyButton value={recoveryCodes.join("\\n")}>
                {({ copied, copy }) => (
                  <Button variant="default" onClick={copy}>
                    {copied ? t("Copied") : t("Copy codes")}
                  </Button>
                )}
              </CopyButton>
              <Button onClick={continueAfterSetup}>{t("Continue")}</Button>
            </Group>
          </Stack>
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
                mx="auto"
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
                      <Button size="xs" variant="default" onClick={copy}>
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
              data-autofocus
            />

            <Button
              onClick={() => confirmMutation.mutate({ token })}
              loading={startMutation.isPending || confirmMutation.isPending}
              disabled={!setup || token.trim().length === 0}
              fullWidth
            >
              {t("Confirm and continue")}
            </Button>
          </Stack>
        )}
      </Box>
    </Container>
  );
}
