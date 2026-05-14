import React from "react";
import { Modal } from "@mantine/core";
import { IAuthProvider } from "@/features/auth/sso/types.ts";
import { SsoSamlForm } from "@/features/auth/sso/components/sso-saml-form.tsx";

interface SsoModalProps {
  opened: boolean;
  onClose: () => void;
  provider: IAuthProvider | null;
}

export default function SsoProviderModal({
  opened,
  onClose,
  provider,
}: SsoModalProps) {
  if (!provider) {
    return null;
  }

  return (
    <Modal
      opened={opened}
      title="Entra ID SAML configuration"
      onClose={onClose}
    >
      <SsoSamlForm provider={provider} onClose={onClose} />
    </Modal>
  );
}
