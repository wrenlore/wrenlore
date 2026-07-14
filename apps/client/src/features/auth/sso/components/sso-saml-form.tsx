import React from "react";
import { z } from "zod/v4";
import { useForm } from "@mantine/form";
import { zod4Resolver } from "mantine-form-zod-resolver";
import {
  Box,
  Button,
  Divider,
  Group,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  buildCallbackUrl,
  buildSamlEntityId,
  buildSamlMetadataUrl,
} from "@/features/auth/sso/utils.ts";
import classes from "@/features/auth/sso/components/sso.module.css";
import { IAuthProvider } from "@/features/auth/sso/types.ts";
import CopyTextButton from "@/components/common/copy.tsx";
import { useTranslation } from "react-i18next";
import { useUpdateSsoProviderMutation } from "@/features/auth/sso/queries.ts";

const SAML_HTTP_POST_BINDING =
  "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" as const;

const ssoSchema = z.object({
  name: z.string().min(1, "Display name is required"),
  spEntityId: z.string(),
  spAcsUrl: z.union([z.literal(""), z.string().url()]),
  spAcsBinding: z.literal(SAML_HTTP_POST_BINDING),
  spSloUrl: z.union([z.literal(""), z.string().url()]),
  nameIdFormat: z.string(),
  idpEntityId: z.string(),
  samlUrl: z.string().url(),
  idpSloUrl: z.union([z.literal(""), z.string().url()]),
  samlCertificate: z.string().min(1, "SAML Idp Certificate is required"),
  isEnabled: z.boolean(),
  allowSignup: z.boolean(),
  groupSync: z.boolean(),
});

type SSOFormValues = z.infer<typeof ssoSchema>;

interface SsoFormProps {
  provider: IAuthProvider;
  onClose?: () => void;
}
export function SsoSamlForm({ provider, onClose }: SsoFormProps) {
  const { t } = useTranslation();
  const updateSsoProviderMutation = useUpdateSsoProviderMutation();

  const generatedCallbackUrl = buildCallbackUrl({
    providerId: provider.id,
    type: provider.type,
  });
  const generatedEntityId = buildSamlEntityId(provider.id);

  const form = useForm<SSOFormValues>({
    initialValues: {
      name: provider.name || "",
      spEntityId: provider.spEntityId || generatedEntityId,
      spAcsUrl: provider.spAcsUrl || generatedCallbackUrl,
      spAcsBinding:
        provider.spAcsBinding === SAML_HTTP_POST_BINDING
          ? provider.spAcsBinding
          : SAML_HTTP_POST_BINDING,
      spSloUrl: provider.spSloUrl || "",
      nameIdFormat:
        provider.nameIdFormat ||
        "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      idpEntityId: provider.idpEntityId || "",
      samlUrl: provider.samlUrl || "",
      idpSloUrl: provider.idpSloUrl || "",
      samlCertificate: provider.samlCertificate || "",
      isEnabled: provider.isEnabled,
      allowSignup: provider.allowSignup,
      groupSync: provider.groupSync || false,
    },
    validate: zod4Resolver(ssoSchema),
  });

  const metadataUrl = buildSamlMetadataUrl(provider.id);

  const handleSubmit = async (values: SSOFormValues) => {
    const ssoData: Partial<IAuthProvider> = {
      providerId: provider.id,
    };
    if (form.isDirty("name")) {
      ssoData.name = values.name;
    }
    if (form.isDirty("samlUrl")) {
      ssoData.samlUrl = values.samlUrl;
    }
    if (form.isDirty("samlCertificate")) {
      ssoData.samlCertificate = values.samlCertificate;
    }
    if (form.isDirty("spEntityId")) {
      ssoData.spEntityId = values.spEntityId || null;
    }
    if (form.isDirty("spAcsUrl")) {
      ssoData.spAcsUrl = values.spAcsUrl || null;
    }
    if (form.isDirty("spAcsBinding")) {
      ssoData.spAcsBinding = values.spAcsBinding;
    }
    if (form.isDirty("spSloUrl")) {
      ssoData.spSloUrl = values.spSloUrl || null;
    }
    if (form.isDirty("nameIdFormat")) {
      ssoData.nameIdFormat = values.nameIdFormat || null;
    }
    if (form.isDirty("idpEntityId")) {
      ssoData.idpEntityId = values.idpEntityId || null;
    }
    if (form.isDirty("idpSloUrl")) {
      ssoData.idpSloUrl = values.idpSloUrl || null;
    }
    if (form.isDirty("isEnabled")) {
      ssoData.isEnabled = values.isEnabled;
    }
    if (form.isDirty("allowSignup")) {
      ssoData.allowSignup = values.allowSignup;
    }
    if (form.isDirty("groupSync")) {
      ssoData.groupSync = values.groupSync;
    }

    await updateSsoProviderMutation.mutateAsync(ssoData);
    form.resetDirty();
    onClose();
  };

  return (
    <Box maw={600} mx="auto">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput
            label={t("Display name")}
            placeholder="e.g. Entra ID"
            data-autofocus
            {...form.getInputProps("name")}
          />
          <Divider />
          <Text fw={600}>Service Provider (WrenLore)</Text>
          <TextInput
            label="SP Entity ID"
            description="Match the Identifier configured in Entra ID"
            rightSection={<CopyTextButton text={form.values.spEntityId} />}
            {...form.getInputProps("spEntityId")}
          />
          <TextInput
            label="SP ACS / Reply URL"
            description="Match the Reply URL configured in Entra ID"
            rightSection={<CopyTextButton text={form.values.spAcsUrl} />}
            {...form.getInputProps("spAcsUrl")}
          />
          <Select
            label="SP ACS binding"
            data={[
              {
                value: SAML_HTTP_POST_BINDING,
                label: "HTTP-POST",
              },
            ]}
            allowDeselect={false}
            {...form.getInputProps("spAcsBinding")}
          />
          <TextInput
            label="SP Single Logout URL"
            placeholder="Optional"
            {...form.getInputProps("spSloUrl")}
          />
          <TextInput
            label="NameID format"
            {...form.getInputProps("nameIdFormat")}
          />
          <TextInput
            label="SP metadata URL"
            variant="filled"
            value={metadataUrl}
            readOnly
            rightSection={<CopyTextButton text={metadataUrl} />}
          />

          <Divider />
          <Text fw={600}>Identity Provider (Entra ID)</Text>
          <TextInput
            label="IdP Entity ID"
            placeholder="https://sts.windows.net/tenant-id/"
            {...form.getInputProps("idpEntityId")}
          />
          <TextInput
            label="IdP SSO URL"
            placeholder="e.g https://login.microsoftonline.com/7d6246d1-273b-4981-ad1e-e7bb27b86569/saml2"
            {...form.getInputProps("samlUrl")}
          />
          <TextInput
            label="IdP Single Logout URL"
            placeholder="Optional"
            {...form.getInputProps("idpSloUrl")}
          />
          <Textarea
            label="IdP signing certificate"
            placeholder="-----BEGIN CERTIFICATE-----"
            autosize
            minRows={3}
            maxRows={5}
            {...form.getInputProps("samlCertificate")}
          />

          <Group justify="space-between">
            <div>{t("Group sync")}</div>
            <Switch
              className={classes.switch}
              checked={form.values.groupSync}
              {...form.getInputProps("groupSync")}
            />
          </Group>

          <Group justify="space-between">
            <div>{t("Allow signup")}</div>
            <Switch
              className={classes.switch}
              checked={form.values.allowSignup}
              {...form.getInputProps("allowSignup")}
            />
          </Group>

          <Group justify="space-between">
            <div>{t("Enabled")}</div>
            <Switch
              className={classes.switch}
              checked={form.values.isEnabled}
              {...form.getInputProps("isEnabled")}
            />
          </Group>

          <Group mt="md" justify="flex-end">
            <Button type="submit" disabled={!form.isDirty()}>
              {t("Save")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Box>
  );
}
