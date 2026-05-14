import {
  Anchor,
  Box,
  Button,
  Container,
  Group,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  completeMfaLogin,
  completeMfaRecoveryLogin,
} from "@/features/auth/services/auth-service";
import APP_ROUTE, { getPostLoginRedirect } from "@/lib/app-route";
import classes from "@/features/auth/components/auth.module.css";

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
  return <Navigate to="/settings/account/profile" replace />;
}
