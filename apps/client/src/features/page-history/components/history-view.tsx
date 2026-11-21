import { usePageHistoryQuery } from "@/features/page-history/queries/page-history-query";
import { HistoryEditor } from "@/features/page-history/components/history-editor";
import { useTranslation } from "react-i18next";
import { useAtomValue } from "jotai";
import {
  activeHistoryIdAtom,
  activeHistoryPrevIdAtom,
} from "@/features/page-history/atoms/history-atoms";

import { Text } from "@mantine/core";

function HistoryView() {
  const { t } = useTranslation();
  const historyId = useAtomValue(activeHistoryIdAtom);
  const prevHistoryId = useAtomValue(activeHistoryPrevIdAtom);

  const {
    data,
    isLoading: isLoadingCurrent,
    isError: isErrorCurrent,
  } = usePageHistoryQuery(historyId);
  const {
    data: prevData,
    isLoading: isLoadingPrev,
    isError: isErrorPrev,
  } = usePageHistoryQuery(prevHistoryId);

  if (isLoadingCurrent || isLoadingPrev) {
    return <></>;
  }

  if (isErrorCurrent || !data) {
    return <div>{t("Error fetching page data.")}</div>;
  }

  return (
    <div>
      {prevData && data.title !== prevData.title && (
        <Text size="sm" c="dimmed" mb="sm">
          {t("Title changed from {{title}}", {
            title: prevData.title || t("Untitled"),
          })}
        </Text>
      )}
      {prevData &&
        (data.icon !== prevData.icon ||
          data.coverPhoto !== prevData.coverPhoto) && (
          <Text size="sm" c="dimmed" mb="sm">
            {t("Page icon or cover changed.")}
          </Text>
        )}
      <HistoryEditor
        content={data.content}
        title={data.title}
        previousContent={!isErrorPrev ? prevData?.content : undefined}
      />
    </div>
  );
}

export default HistoryView;
