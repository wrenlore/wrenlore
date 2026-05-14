import { Menu, ActionIcon, Text } from "@mantine/core";
import React from "react";
import {
  IconDots,
  IconKeyOff,
  IconTrash,
  IconUserCheck,
  IconUserOff,
} from "@tabler/icons-react";
import { modals } from "@mantine/modals";
import {
  useDeleteWorkspaceMemberMutation,
  useDeactivateWorkspaceMemberMutation,
  useActivateWorkspaceMemberMutation,
  useResetWorkspaceMemberMfaMutation,
} from "@/features/workspace/queries/workspace-query.ts";
import { useTranslation } from "react-i18next";
import useUserRole from "@/hooks/use-user-role.tsx";

interface Props {
  userId: string;
  deactivatedAt: Date | null;
}
export default function MemberActionMenu({ userId, deactivatedAt }: Props) {
  const { t } = useTranslation();
  const deleteWorkspaceMemberMutation = useDeleteWorkspaceMemberMutation();
  const deactivateMutation = useDeactivateWorkspaceMemberMutation();
  const activateMutation = useActivateWorkspaceMemberMutation();
  const resetMfaMutation = useResetWorkspaceMemberMfaMutation();
  const { isAdmin } = useUserRole();

  const isDeactivated = !!deactivatedAt;

  const onDeactivate = async () => {
    await deactivateMutation.mutateAsync({ userId });
  };

  const onActivate = async () => {
    await activateMutation.mutateAsync({ userId });
  };

  const openDeactivateModal = () =>
    modals.openConfirmModal({
      title: isDeactivated ? t("Activate member") : t("Deactivate member"),
      children: (
        <Text size="sm">
          {isDeactivated
            ? t("Are you sure you want to activate this workspace member?")
            : t(
                "Are you sure you want to deactivate this workspace member? They will no longer be able to access this workspace.",
              )}
        </Text>
      ),
      centered: true,
      labels: {
        confirm: isDeactivated ? t("Activate") : t("Deactivate"),
        cancel: t("Cancel"),
      },
      confirmProps: { color: isDeactivated ? "blue" : "orange" },
      onConfirm: isDeactivated ? onActivate : onDeactivate,
    });

  const onRevoke = async () => {
    await deleteWorkspaceMemberMutation.mutateAsync({ userId });
  };

  const openRevokeModal = () =>
    modals.openConfirmModal({
      title: t("Delete member"),
      children: (
        <Text size="sm">
          {t(
            "Are you sure you want to delete this workspace member? This action is irreversible.",
          )}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Delete"), cancel: t("Don't") },
      confirmProps: { color: "red" },
      onConfirm: onRevoke,
    });

  const openResetMfaModal = () =>
    modals.openConfirmModal({
      title: t("Reset member MFA"),
      children: (
        <Text size="sm">
          {t(
            "Reset MFA for this member? Their authenticator setup and recovery codes will be removed. If MFA is required, they must set it up again at next local password login.",
          )}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Reset MFA"), cancel: t("Cancel") },
      confirmProps: { color: "orange" },
      onConfirm: () => resetMfaMutation.mutateAsync({ userId }),
    });

  return (
    <>
      <Menu
        shadow="xl"
        position="bottom-end"
        offset={20}
        width={200}
        withArrow
        arrowPosition="center"
      >
        <Menu.Target>
          <ActionIcon variant="subtle" c="gray">
            <IconDots size={20} stroke={2} />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item
            onClick={openDeactivateModal}
            leftSection={
              isDeactivated ? (
                <IconUserCheck size={16} />
              ) : (
                <IconUserOff size={16} />
              )
            }
            disabled={!isAdmin}
          >
            {isDeactivated ? t("Activate member") : t("Deactivate member")}
          </Menu.Item>

          <Menu.Item
            onClick={openResetMfaModal}
            leftSection={<IconKeyOff size={16} />}
            disabled={!isAdmin}
          >
            {t("Reset MFA")}
          </Menu.Item>

          <Menu.Divider />

          <Menu.Item
            c="red"
            onClick={openRevokeModal}
            leftSection={<IconTrash size={16} />}
            disabled={!isAdmin}
          >
            {t("Delete member")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </>
  );
}
