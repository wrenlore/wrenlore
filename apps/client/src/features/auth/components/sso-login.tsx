import { useWorkspacePublicDataQuery } from "@/features/workspace/queries/workspace-query.ts";
import { Button, Divider, Stack } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { buildSsoLoginUrl } from "@/features/auth/sso/utils.ts";
import { SSO_PROVIDER } from "@/features/auth/sso/constants.ts";

export default function SsoLogin() {
  const { data, isLoading } = useWorkspacePublicDataQuery();
  const enforceSso = data?.enforceSso ?? false;
  const providers =
    data?.authProviders?.filter((provider) => provider.type === SSO_PROVIDER.SAML) ??
    [];

  if (isLoading) {
    return null;
  }

  if (providers.length === 0) {
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
      </Stack>

      {!enforceSso && <Divider my="xs" label="OR" labelPosition="center" />}
    </>
  );
}
