import { Helmet } from "react-helmet-async";
import { getAppName } from "@/lib/config.ts";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import { Divider, Title } from "@mantine/core";
import React from "react";
import useUserRole from "@/hooks/use-user-role.tsx";
import SsoProviderList from "@/features/auth/sso/components/sso-provider-list.tsx";
import CreateSsoProvider from "@/features/auth/sso/components/create-sso-provider.tsx";
import EnforceSso from "@/features/auth/sso/components/enforce-sso.tsx";
import AllowedDomains from "@/features/auth/sso/components/allowed-domains.tsx";
import { useTranslation } from "react-i18next";
import DisablePublicSharing from "@/wrenlore/security/components/disable-public-sharing.tsx";
import TrashRetention from "@/wrenlore/security/components/trash-retention.tsx";
import EnforceMfa from "@/wrenlore/security/components/enforce-mfa.tsx";

export default function Security() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();

  if (!isAdmin) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>Security - {getAppName()}</title>
      </Helmet>
      <SettingsTitle title={t("Security")} />

      <DisablePublicSharing />
      <Divider my="lg" />

      <TrashRetention />
      <Divider my="lg" />

      <EnforceMfa />
      <Divider my="lg" />

      <Title order={4} my="lg">
        Single sign-on (Entra ID)
      </Title>

      <EnforceSso />
      <Divider my="lg" />

      <AllowedDomains />
      <Divider my="lg" />

      <CreateSsoProvider />
      <Divider size={0} my="lg" />

      <SsoProviderList />
    </>
  );
}
