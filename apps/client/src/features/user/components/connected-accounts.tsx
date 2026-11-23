import { useEffect } from "react";
import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconBrandGithub,
  IconBrandGoogle,
  IconLink,
  IconLinkOff,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import api from "@/lib/api-client.ts";

interface ISocialAccount {
  id: string;
  providerType: "github" | "google";
  providerName: string;
  connectedAt: string;
}

const PROVIDERS = [
  { type: "github", label: "GitHub", icon: IconBrandGithub },
  { type: "google", label: "Google", icon: IconBrandGoogle },
] as const;

async function getConnectedAccounts(): Promise<{
  items: ISocialAccount[];
  linkingAllowed: boolean;
}> {
  const req = await api.post<{
    items: ISocialAccount[];
    linkingAllowed: boolean;
  }>("/auth/social/accounts");
  return req.data;
}

async function startSocialLink(providerType: string): Promise<{ url: string }> {
  const req = await api.post<{ url: string }>("/auth/social/link/start", {
    providerType,
  });
  return req.data;
}

async function unlinkSocialAccount(providerType: string): Promise<void> {
  await api.post("/auth/social/unlink", { providerType });
}

export function ConnectedAccounts() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading } = useQuery({
    queryKey: ["social-accounts"],
    queryFn: getConnectedAccounts,
  });

  // Success hand-off from the social connect callback.
  useEffect(() => {
    if (searchParams.get("social") === "connected") {
      notifications.show({
        message: t("Account connected successfully"),
        color: "teal",
      });
      searchParams.delete("social");
      setSearchParams(searchParams, { replace: true });
      queryClient.invalidateQueries({ queryKey: ["social-accounts"] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const connectMutation = useMutation({
    mutationFn: (providerType: string) => startSocialLink(providerType),
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (error: any) => {
      notifications.show({
        message:
          error?.response?.data?.message ??
          t("Could not start the connection. Please try again."),
        color: "red",
      });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (providerType: string) => unlinkSocialAccount(providerType),
    onSuccess: () => {
      notifications.show({
        message: t("Account disconnected"),
        color: "teal",
      });
      queryClient.invalidateQueries({ queryKey: ["social-accounts"] });
    },
    onError: (error: any) => {
      notifications.show({
        message:
          error?.response?.data?.message ??
          t("Could not disconnect the account."),
        color: "red",
      });
    },
  });

  const accounts = data?.items ?? [];

  return (
    <>
      <Title order={4} mb="xs">
        {t("Connected accounts")}
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        {t(
          "Connect GitHub or Google to sign in without a password. Connecting requires a recent sign-in.",
        )}
      </Text>

      {data && !data.linkingAllowed && (
        <Text size="sm" c="dimmed" mb="md">
          {t("This workspace enforces enterprise single sign-on.")}
        </Text>
      )}
      {isLoading ? (
        <Loader size="sm" />
      ) : (
        <Stack gap="xs">
          {PROVIDERS.map((provider) => {
            const account = accounts.find(
              (item) => item.providerType === provider.type,
            );
            const Icon = provider.icon;
            return (
              <Group
                key={provider.type}
                justify="space-between"
                data-testid={`connected-account-${provider.type}`}
              >
                <Group gap="sm">
                  <Icon size={18} />
                  <Text size="sm">{provider.label}</Text>
                  {account && (
                    <Text size="xs" c="dimmed">
                      {t("Connected")}
                    </Text>
                  )}
                </Group>
                {account ? (
                  <Tooltip label={t("Disconnect")}>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      data-testid={`social-unlink-${provider.type}`}
                      onClick={() => unlinkMutation.mutate(provider.type)}
                    >
                      <IconLinkOff size={16} />
                    </ActionIcon>
                  </Tooltip>
                ) : (
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconLink size={14} />}
                    loading={connectMutation.isPending}
                    disabled={!data?.linkingAllowed}
                    data-testid={`social-connect-${provider.type}`}
                    onClick={() => connectMutation.mutate(provider.type)}
                  >
                    {t("Connect")}
                  </Button>
                )}
              </Group>
            );
          })}
        </Stack>
      )}
    </>
  );
}
