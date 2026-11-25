import { z } from "zod/v4";
import { useForm } from "@mantine/form";
import { zod4Resolver } from "mantine-form-zod-resolver";
import useAuth from "@/features/auth/hooks/use-auth";
import {
  Container,
  Title,
  TextInput,
  Button,
  PasswordInput,
  Box,
  Anchor,
  Group,
  Code,
  Stack,
  Text,
} from "@mantine/core";
import classes from "./auth.module.css";
import { useRedirectIfAuthenticated } from "@/features/auth/hooks/use-redirect-if-authenticated.ts";
import { Link } from "react-router";
import APP_ROUTE from "@/lib/app-route.ts";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { notifications } from "@mantine/notifications";
import SsoLogin from "@/features/auth/components/sso-login.tsx";
import { useWorkspacePublicDataQuery } from "@/features/workspace/queries/workspace-query.ts";
import { Error404 } from "@/components/ui/error-404.tsx";
import React from "react";
import {
  getDemoEmail,
  getDemoPassword,
  getDemoResetSchedule,
  isDemoMode,
} from "@/lib/config.ts";

const formSchema = z.object({
  email: z.email().min(1, { message: "email is required" }),
  password: z.string().min(1, { message: "Password is required" }),
});
type FormValues = z.infer<typeof formSchema>;

// Messages for social login failures coming back from the OAuth callback.
// They intentionally avoid disclosing whether an account exists.
const SOCIAL_LOGIN_ERROR_MESSAGES: Record<string, string> = {
  sso_enforced:
    "This workspace requires enterprise single sign-on. Social login is not available.",
  provider_disabled: "This login provider is no longer enabled.",
  provider_not_configured: "This login provider is not fully configured.",
  provider_rejected: "The login provider cancelled or rejected the sign-in.",
  state_invalid:
    "This sign-in attempt expired or was already used. Please try again.",
  identity_failed: "We could not verify your identity with the login provider.",
  account_disabled: "This account is disabled.",
  account_not_linked:
    "No connected account was found for this provider identity. Sign in with your usual method and connect the account in your account settings, or ask an administrator to enable sign-up.",
  signup_not_allowed:
    "New sign-ups are not allowed in this workspace. Ask an administrator for an invitation.",
  email_unverified:
    "Your provider account has no verified email address, so sign-up cannot continue.",
  domain_not_allowed: "This email domain is not approved for this workspace.",
  link_collision:
    "This provider identity is already connected to another account.",
};

export function LoginForm() {
  const { t } = useTranslation();
  const { signIn, isLoading } = useAuth();
  useRedirectIfAuthenticated();
  const [searchParams] = useSearchParams();
  const {
    data,
    isLoading: isDataLoading,
    isError,
    error,
  } = useWorkspacePublicDataQuery();

  // Surface social login failures returned by the OAuth callback redirect.
  const loginError = searchParams.get("error");
  useEffect(() => {
    if (loginError) {
      notifications.show({
        color: "red",
        message:
          SOCIAL_LOGIN_ERROR_MESSAGES[loginError] ??
          t("Social login failed. Please try again."),
      });
      searchParams.delete("error");
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${searchParams.toString() ? `?${searchParams}` : ""}`,
      );
    }
  }, [loginError]);

  const form = useForm<FormValues>({
    validate: zod4Resolver(formSchema),
    initialValues: {
      email: isDemoMode() ? getDemoEmail() : "",
      password: isDemoMode() ? getDemoPassword() : "",
    },
  });

  async function onSubmit(data: FormValues) {
    await signIn(data);
  }

  if (isDataLoading) {
    return null;
  }

  if (isError && error?.["response"]?.status === 404) {
    return <Error404 />;
  }

  return (
    <Container size={420} className={classes.container}>
      <Box p="xl" className={classes.containerBox}>
        <Title order={2} ta="center" fw={500} mb="md">
          {isDemoMode() ? "Explore the WrenLore demo" : t("Login")}
        </Title>

        {isDemoMode() && (
          <Box className={classes.demoAccess} mb="lg">
            <Text fw={600} mb={4}>
              Demo login
            </Text>
            <Text size="sm" c="dimmed" mb="sm">
              Use the shared account below. Changes are temporary
              {getDemoResetSchedule()
                ? ` and reset ${getDemoResetSchedule()}`
                : ""}
              .
            </Text>
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm">Email</Text>
                <Code>{getDemoEmail()}</Code>
              </Group>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm">Password</Text>
                <Code>{getDemoPassword()}</Code>
              </Group>
            </Stack>
          </Box>
        )}

        {!isDemoMode() && <SsoLogin />}

        {!data?.enforceSso && (
          <>
            <form onSubmit={form.onSubmit(onSubmit)}>
              <TextInput
                id="email"
                type="email"
                label={t("Email")}
                placeholder="email@example.com"
                variant="filled"
                {...form.getInputProps("email")}
              />

              <PasswordInput
                label={t("Password")}
                placeholder={t("Your password")}
                variant="filled"
                mt="md"
                {...form.getInputProps("password")}
              />

              {!isDemoMode() && (
                <Group justify="flex-end" mt="sm">
                  <Anchor
                    to={APP_ROUTE.AUTH.FORGOT_PASSWORD}
                    component={Link}
                    underline="never"
                    size="sm"
                  >
                    {t("Forgot your password?")}
                  </Anchor>
                </Group>
              )}

              <Button type="submit" fullWidth mt="md" loading={isLoading}>
                {t("Sign In")}
              </Button>
            </form>
          </>
        )}
      </Box>
    </Container>
  );
}
