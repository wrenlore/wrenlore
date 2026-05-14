import React, { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { Button, Group } from "@mantine/core";
import { useCreateSsoProviderMutation } from "@/features/auth/sso/queries.ts";
import { SSO_PROVIDER } from "@/features/auth/sso/constants.ts";
import { IAuthProvider } from "@/features/auth/sso/types.ts";
import SsoProviderModal from "@/features/auth/sso/components/sso-provider-modal.tsx";

export default function CreateSsoProvider() {
  const [opened, { open, close }] = useDisclosure(false);
  const [provider, setProvider] = useState<IAuthProvider | null>(null);

  const createSsoProviderMutation = useCreateSsoProviderMutation();

  const handleCreateSAML = async () => {
    try {
      const newProvider = await createSsoProviderMutation.mutateAsync({
        type: SSO_PROVIDER.SAML,
        name: "Entra ID",
      });
      setProvider(newProvider);
      open();
    } catch (error) {
      console.error("Failed to create SAML provider", error);
    }
  };

  return (
    <>
      <SsoProviderModal opened={opened} onClose={close} provider={provider} />

      <Group justify="flex-end">
        <Button onClick={handleCreateSAML}>Create Entra ID SSO</Button>
      </Group>
    </>
  );
}
