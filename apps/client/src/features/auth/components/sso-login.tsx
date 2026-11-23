import { useWorkspacePublicDataQuery } from "@/features/workspace/queries/workspace-query.ts";
import { Button, Divider, Stack } from "@mantine/core";
import { IconBrandGithub, IconBrandGoogle, IconLock } from "@tabler/icons-react";
import { buildSsoLoginUrl } from "@/features/auth/sso/utils.ts";
import { SSO_PROVIDER } from "@/features/auth/sso/constants.ts";
import { useTranslation } from "react-i18next";

const SOCIAL_PROVIDERS: {
  type: SSO_PROVIDER;
  labelKey: string;
  icon: typeof IconBrandGithub;
}[] = [
  { type: SSO_PROVIDER.GITHUB, labelKey: "Continue with GitHub", icon: IconBrandGithub },
  { type: SSO_PROVIDER.GOOGLE, labelKey: "Continue with Google", icon: IconBrandGoogle },
];

export function buildSocialStartUrl(type: SSO_PROVIDER): string {
  const redirect = new URLSearchParams(window.location.search).get("redirect");
  const params = redirect ? `?redirect=${encodeURIComponent(redirect)}` : "";
  return `${window.location.origin}/api/auth/social/${type}/start${params}`;
}

export default function SsoLogin() {
  const { t } = useTranslation();
  const { data, isLoading } = useWorkspacePublicDataQuery();
  const enforceSso = data?.enforceSso ?? false;
  const providers =
    data?.authProviders?.filter((provider) => provider.type === SSO_PROVIDER.SAML) ??
    [];
  // Enforced SAML SSO must not be bypassed by social login, so social
  // buttons are hidden entirely (the backend rejects them as well).
  const socialProviders = enforceSso
    ? []
    : (data?.authProviders ?? []).filter((provider) =>
        SOCIAL_PROVIDERS.some((social) => social.type === provider.type),
      );

  if (isLoading) {
    return null;
  }

  if (providers.length === 0 && socialProviders.length === 0) {
    return null;
  }

  return (
    <>
      <Stack align="stretch" justify="center" gap="sm">
        {providers.map((provider) => (
          <div key={provider.id}>
            <Button
              onClick={() => {
                window.location.href = buildSsoLoginUrl({
                  providerId: provider.id,
                  type: provider.type,
                });
              }}
              leftSection={<IconLock size={16} />}
              variant="default"
              fullWidth
            >
              {provider.name}
            </Button>
          </div>
        ))}

        {SOCIAL_PROVIDERS.map((social) => {
          if (!socialProviders.some((p) => p.type === social.type)) {
            return null;
          }
          const Icon = social.icon;
          return (
            <div key={social.type}>
              <Button
                data-testid={`social-login-${social.type}`}
                onClick={() => {
                  window.location.href = buildSocialStartUrl(social.type);
                }}
                leftSection={<Icon size={16} />}
                variant="default"
                fullWidth
              >
                {t(social.labelKey)}
              </Button>
            </div>
          );
        })}
      </Stack>

      {!enforceSso && <Divider my="xs" label="OR" labelPosition="center" />}
    </>
  );
}
