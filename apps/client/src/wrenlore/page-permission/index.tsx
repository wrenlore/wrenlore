import ShareModal from "@/features/share/components/share-modal";
import api from "@/lib/api-client";
import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Popover,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconLock, IconLockOpen, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { usePageQuery } from "@/features/page/queries/page-query";
import { extractPageSlugId } from "@/lib";
import {
  MultiMemberSelect,
} from "@/features/space/components/multi-member-select";
import type { MultiMemberOption } from "@/features/space/components/multi-member-select";

type PagePermissionRole = "reader" | "writer";
type PagePermissionMemberType = "user" | "group";

interface PagePermissionMember {
  id: string;
  name?: string;
  email?: string;
  type: PagePermissionMemberType;
  role: PagePermissionRole;
}

interface PagePermissionInfo {
  restricted: boolean;
  inherited: boolean;
  canAccess: boolean;
  canEdit: boolean;
  members: PagePermissionMember[];
}

async function getPagePermissionInfo(
  pageId: string,
): Promise<PagePermissionInfo> {
  const req = await api.post<PagePermissionInfo>("/pages/permissions/info", {
    pageId,
  });
  return req.data;
}

async function setPagePermissions(params: {
  pageId: string;
  members: PagePermissionMember[];
}): Promise<PagePermissionInfo> {
  const req = await api.post<PagePermissionInfo>("/pages/permissions/set", {
    pageId: params.pageId,
    members: params.members.map((member) => ({
      id: member.id,
      type: member.type,
      role: member.role,
    })),
  });
  return req.data;
}

async function clearPagePermissions(pageId: string): Promise<PagePermissionInfo> {
  const req = await api.post<PagePermissionInfo>("/pages/permissions/clear", {
    pageId,
  });
  return req.data;
}

export function PageShareModal({ readOnly }: { readOnly?: boolean }) {
  return (
    <Group gap={4} wrap="nowrap">
      <PageAccessPopover readOnly={readOnly ?? false} />
      <ShareModal readOnly={readOnly ?? false} />
    </Group>
  );
}

function PageAccessPopover({ readOnly }: { readOnly: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pageSlug } = useParams();
  const pageSlugId = extractPageSlugId(pageSlug);
  const { data: page } = usePageQuery({ pageId: pageSlugId });
  const pageId = page?.id;
  const [members, setMembers] = useState<PagePermissionMember[]>([]);

  const permissionQuery = useQuery({
    queryKey: ["page-permissions", pageId],
    queryFn: () => getPagePermissionInfo(pageId),
    enabled: !!pageId,
  });

  useEffect(() => {
    if (permissionQuery.data?.members) {
      setMembers(permissionQuery.data.members);
    }
  }, [permissionQuery.data?.members]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["page-permissions", pageId] }),
      queryClient.invalidateQueries({ queryKey: ["pages", pageId] }),
      queryClient.invalidateQueries({ queryKey: ["sidebar-pages"] }),
      queryClient.invalidateQueries({ queryKey: ["unified-search"] }),
    ]);
  };

  const setPermissionsMutation = useMutation({
    mutationFn: setPagePermissions,
    onSuccess: async () => {
      notifications.show({ message: t("Page permissions updated") });
      await invalidate();
    },
    onError: (error) => {
      notifications.show({
        message:
          error?.["response"]?.data?.message ||
          t("Failed to update page permissions"),
        color: "red",
      });
    },
  });

  const clearPermissionsMutation = useMutation({
    mutationFn: clearPagePermissions,
    onSuccess: async () => {
      notifications.show({ message: t("Page restriction removed") });
      await invalidate();
    },
    onError: (error) => {
      notifications.show({
        message:
          error?.["response"]?.data?.message ||
          t("Failed to remove page restriction"),
        color: "red",
      });
    },
  });

  const permissionInfo = permissionQuery.data;
  const isRestricted =
    permissionInfo?.restricted || permissionInfo?.inherited || false;
  const canManage = !readOnly && permissionInfo?.canEdit === true;
  const creatorId = page?.creatorId;

  const roleOptions = useMemo(
    () => [
      { value: "reader", label: t("Can view") },
      { value: "writer", label: t("Can edit") },
    ],
    [t],
  );

  const memberLabel = (member: PagePermissionMember) =>
    member.name || member.email || member.id;

  const isCreator = (member: PagePermissionMember) =>
    member.type === "user" && member.id === creatorId;

  const addSelectedMembers = (
    values: string[],
    selectedOptions: MultiMemberOption[] = [],
  ) => {
    setMembers((current) => {
      const byKey = new Map(
        current.map((member) => [`${member.type}-${member.id}`, member]),
      );
      const selectedByValue = new Map(
        selectedOptions.map((option) => [option.value, option]),
      );

      for (const value of values) {
        const [type, ...idParts] = value.split("-");
        const id = idParts.join("-");
        if ((type === "user" || type === "group") && id) {
          const option = selectedByValue.get(value);
          byKey.set(value, {
            id,
            type,
            name: option?.label,
            email: option?.email,
            role: type === "user" && id === creatorId ? "writer" : "reader",
          });
        }
      }

      return [...byKey.values()];
    });
  };

  const updateRole = (member: PagePermissionMember, role: PagePermissionRole) => {
    if (isCreator(member)) return;

    setMembers((current) =>
      current.map((item) =>
        item.id === member.id && item.type === member.type
          ? { ...item, role }
          : item,
      ),
    );
  };

  const removeMember = (member: PagePermissionMember) => {
    if (isCreator(member)) return;

    setMembers((current) =>
      current.filter(
        (item) => item.id !== member.id || item.type !== member.type,
      ),
    );
  };

  const saveRestriction = () => {
    if (!pageId) return;
    setPermissionsMutation.mutate({
      pageId,
      members: members.map((member) =>
        isCreator(member) ? { ...member, role: "writer" } : member,
      ),
    });
  };

  const clearRestriction = () => {
    if (!pageId) return;
    clearPermissionsMutation.mutate(pageId);
  };

  return (
    <Popover width={380} position="bottom" withArrow shadow="md">
      <Popover.Target>
        <Button
          size="compact-sm"
          leftSection={
            isRestricted ? (
              <IconLock size={18} stroke={1.7} />
            ) : (
              <IconLockOpen size={18} stroke={1.7} />
            )
          }
          color={isRestricted ? "orange" : "dark"}
          variant="subtle"
        >
          {t("Access")}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <div>
            <Text size="sm" fw={600}>
              {isRestricted ? t("Restricted page") : t("Open to space members")}
            </Text>
            <Text size="xs" c="dimmed">
              {permissionInfo?.inherited && !permissionInfo?.restricted
                ? t("This page inherits access from a restricted parent.")
                : t("Restricted access applies to this page and its sub-pages.")}
            </Text>
          </div>

          {canManage && !permissionInfo?.inherited && (
            <>
              <MultiMemberSelect
                value={[]}
                onChange={() => undefined}
                onMembersChange={(selectedOptions) =>
                  addSelectedMembers(
                    selectedOptions.map((option) => option.value),
                    selectedOptions,
                  )
                }
                spaceId={page?.spaceId}
                dropdownWithinPortal={false}
              />
              <Text size="xs" c="dimmed">
                {t("You remain a page permission writer when restrictions are saved.")}
              </Text>
            </>
          )}

          {members.length > 0 && (
            <Stack gap={6}>
              {members.map((member) => (
                <Group
                  key={`${member.type}-${member.id}`}
                  justify="space-between"
                  wrap="nowrap"
                >
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" lineClamp={1}>
                      {memberLabel(member)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {isCreator(member)
                        ? t("Creator")
                        : member.type === "group"
                          ? t("Group")
                          : t("User")}
                    </Text>
                  </div>
                  <Group gap={4} wrap="nowrap">
                    <Select
                      size="xs"
                      data={roleOptions}
                      value={isCreator(member) ? "writer" : member.role}
                      disabled={
                        !canManage ||
                        permissionInfo?.inherited ||
                        isCreator(member)
                      }
                      onChange={(role) =>
                        updateRole(member, role as PagePermissionRole)
                      }
                      w={110}
                    />
                    {canManage && !permissionInfo?.inherited && (
                      <Tooltip label={t("Remove")} withArrow>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          disabled={isCreator(member)}
                          onClick={() => removeMember(member)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                </Group>
              ))}
            </Stack>
          )}

          {canManage && !permissionInfo?.inherited && (
            <>
              <Divider />
              <Group justify="space-between">
                <Button
                  variant="subtle"
                  color="red"
                  disabled={!permissionInfo?.restricted}
                  loading={clearPermissionsMutation.isPending}
                  onClick={clearRestriction}
                >
                  {t("Remove restriction")}
                </Button>
                <Button
                  loading={setPermissionsMutation.isPending}
                  onClick={saveRestriction}
                >
                  {permissionInfo?.restricted ? t("Save") : t("Restrict page")}
                </Button>
              </Group>
            </>
          )}

          {!canManage && (
            <Text size="xs" c="dimmed">
              {t("Only users with edit access can manage page permissions.")}
            </Text>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
