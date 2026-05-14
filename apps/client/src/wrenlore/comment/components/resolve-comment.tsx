import { ActionIcon, Tooltip } from "@mantine/core";
import { IconCircleCheck, IconCircleCheckFilled } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useResolveCommentMutation } from "@/wrenlore/comment/queries/comment-query";

export default function ResolveComment({
  editor,
  commentId,
  pageId,
  resolvedAt,
}: {
  editor: any;
  commentId: string;
  pageId: string;
  resolvedAt?: string | Date | null;
}) {
  const { t } = useTranslation();
  const mutation = useResolveCommentMutation();
  const resolved = resolvedAt != null;

  async function toggleResolved() {
    await mutation.mutateAsync({ commentId, pageId, resolved: !resolved });
    editor?.commands?.setCommentResolved?.(commentId, !resolved);
  }

  return (
    <Tooltip label={resolved ? t("Re-open comment") : t("Resolve comment")}>
      <ActionIcon variant="subtle" onClick={toggleResolved} loading={mutation.isPending}>
        {resolved ? <IconCircleCheckFilled size={16} /> : <IconCircleCheck size={16} />}
      </ActionIcon>
    </Tooltip>
  );
}
