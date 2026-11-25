import { Button, Text, Tabs, Space } from "@mantine/core";
import { IconClockHour3, IconPlus } from "@tabler/icons-react";
import RecentChanges from "@/components/common/recent-changes.tsx";
import { useTranslation } from "react-i18next";
import { useGetSpacesQuery } from "@/features/space/queries/space-query.ts";
import { useCreatePageMutation } from "@/features/page/queries/page-query.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { useNavigate } from "react-router";

export default function HomeTabs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: spaces } = useGetSpacesQuery({ limit: 1 });
  const createPage = useCreatePageMutation();
  const firstSpace = spaces?.items[0];

  async function createFirstPage() {
    if (!firstSpace) return;
    const payload = { spaceId: firstSpace.id, parentPageId: undefined };
    const page = await createPage.mutateAsync(payload);
    navigate(buildPageUrl(firstSpace.slug, page.slugId, page.title));
  }

  return (
    <Tabs defaultValue="recent">
      <Tabs.List>
        <Tabs.Tab value="recent" leftSection={<IconClockHour3 size={18} />}>
          <Text size="sm" fw={500}>
            {t("Recently updated")}
          </Text>
        </Tabs.Tab>
      </Tabs.List>

      <Space my="md" />

      <Tabs.Panel value="recent">
        <RecentChanges
          emptyAction={
            firstSpace ? (
              <Button
                mt="sm"
                leftSection={<IconPlus size={16} />}
                loading={createPage.isPending}
                onClick={createFirstPage}
              >
                {t("New page")}
              </Button>
            ) : undefined
          }
        />
      </Tabs.Panel>
    </Tabs>
  );
}
