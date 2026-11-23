import { useEffect } from "react";
import { useForm } from "@mantine/form";
import {
  Button,
  Card,
  Group,
  Loader,
  PasswordInput,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconBrandGithub, IconBrandGoogle } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import CopyTextButton from "@/components/common/copy.tsx";
import {
  useCreateSsoProviderMutation,
  useGetSsoProviders,
  useUpdateSsoProviderMutation,
} from "@/features/auth/sso/queries.ts";
import { SSO_PROVIDER } from "@/features/auth/sso/constants.ts";
import { IAuthProvider } from "@/features/auth/sso/types.ts";

const PROVIDER_META = {
  [SSO_PROVIDER.GITHUB]: {
    label: "GitHub",
    icon: IconBrandGithub,
    docsHint: "Register an OAuth app on GitHub and use the callback URL below as the authorization callback URL.",
  },
  [SSO_PROVIDER.GOOGLE]: {
    label: "Google",
    icon: IconBrandGoogle,
    docsHint: "Create an OAuth 2.0 Web client in Google Cloud and use the callback URL below as an authorized redirect URI.",
  },
} as const;

type SocialType = SSO_PROVIDER.GITHUB | SSO_PROVIDER.GOOGLE;

export default function SocialLoginProviders() {
  const { t } = useTranslation();
  const { data, isLoading } = useGetSsoProviders();

  if (isLoading) {
    return <Loader size="sm" />;
  }

  const providers = data?.items ?? [];

  return (
    <>
      <Title order={4} my="lg">
        {t("Social login")}
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        {t(
          "Let members sign in with GitHub or Google. Each provider is independent and starts disabled.",
        )}
      </Text>
      <Stack gap="lg">
        <SocialProviderCard
          type={SSO_PROVIDER.GITHUB}
          provider={providers.find((p) => p.type === SSO_PROVIDER.GITHUB)}
        />
        <SocialProviderCard
          type={SSO_PROVIDER.GOOGLE}
          provider={providers.find((p) => p.type === SSO_PROVIDER.GOOGLE)}
        />
      </Stack>
    </>
  );
}

function SocialProviderCard({
  type,
  provider,
}: {
  type: SocialType;
  provider?: IAuthProvider;
}) {
  const { t } = useTranslation();
  const meta = PROVIDER_META[type];
  const Icon = meta.icon;
  const createMutation = useCreateSsoProviderMutation();
  const updateMutation = useUpdateSsoProviderMutation();

  const form = useForm({
    initialValues: {
      clientId: provider?.oidcClientId ?? "",
      clientSecret: "",
      allowSignup: provider?.allowSignup ?? false,
      isEnabled: provider?.isEnabled ?? false,
    },
  });

  // Keep the form in sync when the provider loads or is saved.
  useEffect(() => {
    form.setInitialValues({
      clientId: provider?.oidcClientId ?? "",
      clientSecret: "",
      allowSignup: provider?.allowSignup ?? false,
      isEnabled: provider?.isEnabled ?? false,
    });
    form.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider?.id, provider?.oidcClientId, provider?.allowSignup, provider?.isEnabled]);

  const handleSubmit = async (values: typeof form.values) => {
    if (!provider) {
      await createMutation.mutateAsync({
        type,
        name: meta.label,
        clientId: values.clientId || undefined,
        clientSecret: values.clientSecret || undefined,
        allowSignup: values.allowSignup,
        isEnabled: values.isEnabled,
      });
      return;
    }

    const payload: Record<string, unknown> = { providerId: provider.id };
    if (form.isDirty("clientId")) payload.clientId = values.clientId;
    if (values.clientSecret) payload.clientSecret = values.clientSecret;
    if (form.isDirty("allowSignup")) payload.allowSignup = values.allowSignup;
    if (form.isDirty("isEnabled")) payload.isEnabled = values.isEnabled;

    await updateMutation.mutateAsync(payload as Partial<IAuthProvider>);
    form.resetDirty();
  };

  const saveDisabled = provider
    ? !form.isDirty()
    : !form.values.clientId && !form.values.clientSecret;

  return (
    <Card withBorder padding="lg" data-testid={`social-provider-${type}`}>
      <Stack>
        <Group>
          <Icon size={20} />
          <Title order={5}>{meta.label}</Title>
        </Group>
        <Text size="sm" c="dimmed">
          {t(meta.docsHint)}
        </Text>

        {provider?.callbackUrl && (
          <TextInput
            label={t("Callback URL")}
            description={t("Add this exact URL to your OAuth app configuration.")}
            value={provider.callbackUrl}
            readOnly
            variant="filled"
            data-testid={`social-callback-${type}`}
            rightSection={<CopyTextButton text={provider.callbackUrl} />}
            rightSectionWidth={40}
          />
        )}

        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            <TextInput
              label="Client ID"
              data-testid={`social-client-id-${type}`}
              {...form.getInputProps("clientId")}
            />
            <PasswordInput
              label="Client secret"
              placeholder={
                provider?.hasClientSecret
                  ? t("Configured — leave empty to keep the current secret")
                  : ""
              }
              data-testid={`social-client-secret-${type}`}
              {...form.getInputProps("clientSecret")}
            />

            <Group justify="space-between">
              <div>
                <Text size="sm">{t("Allow new sign-ups")}</Text>
                <Text size="xs" c="dimmed">
                  {t(
                    "Create a WrenLore account automatically for new provider users with a verified email.",
                  )}
                </Text>
              </div>
              <Switch
                data-testid={`social-allow-signup-${type}`}
                checked={form.values.allowSignup}
                {...form.getInputProps("allowSignup")}
              />
            </Group>

            <Group justify="space-between">
              <div>
                <Text size="sm">{t("Enabled")}</Text>
                <Text size="xs" c="dimmed">
                  {t(
                    "Disabling blocks new sign-in attempts immediately, including in-flight ones.",
                  )}
                </Text>
              </div>
              <Switch
                data-testid={`social-enabled-${type}`}
                checked={form.values.isEnabled}
                {...form.getInputProps("isEnabled")}
              />
            </Group>

            <Group justify="flex-end">
              <Button
                type="submit"
                size="sm"
                loading={createMutation.isPending || updateMutation.isPending}
                disabled={saveDisabled}
                data-testid={`social-save-${type}`}
              >
                {t("Save")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Stack>
    </Card>
  );
}
