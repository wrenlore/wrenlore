import { Divider, Stack, Switch } from "@mantine/core";
import { Helmet } from "react-helmet-async";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title";
import { getAppName } from "@/lib/config";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";
import { updateWorkspace } from "@/features/workspace/services/workspace-service";
import { queryClient } from "@/main";
import { AiProviderAdmin } from "@/wrenlore/ai/components/admin/ai-provider-admin";

export default function AiSettings() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const ai = workspace?.settings?.ai ?? {};

  async function updateAiSetting(key: "search" | "generative" | "mcp", value: boolean) {
    const field =
      key === "search" ? "aiSearch" : key === "mcp" ? "mcpEnabled" : "generativeAi";
    const updated = await updateWorkspace({ [field]: value } as any);
    setWorkspace(updated);
    await queryClient.invalidateQueries({ queryKey: ["current-user"] });
  }

  return (
    <>
      <Helmet>
        <title>AI settings - {getAppName()}</title>
      </Helmet>
      <SettingsTitle title={t("AI settings")} />
      <Stack gap="md">
        <Switch
          label={t("AI Answers")}
          description={t("Enable grounded answers through the WrenLore AI route.")}
          checked={ai.search === true}
          onChange={(event) => updateAiSetting("search", event.currentTarget.checked)}
        />
        <Divider />
        <Switch
          label={t("Ask AI")}
          description={t("Enable AI-assisted editor actions through /api/wren-ai/*.")}
          checked={ai.generative === true}
          onChange={(event) => updateAiSetting("generative", event.currentTarget.checked)}
        />
        <Divider />
        <AiProviderAdmin />
        <Divider />
        <Switch
          label={t("MCP agent connections")}
          description={t(
            "Allow users to connect agents using scoped tokens. Users manage their connections in Account → Agent connections.",
          )}
          checked={ai.mcp === true}
          onChange={(event) => updateAiSetting("mcp", event.currentTarget.checked)}
        />
      </Stack>
    </>
  );
}
