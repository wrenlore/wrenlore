import { Box, Button, Group, ScrollArea, Select, Text } from "@mantine/core";
import { useAtom, useSetAtom } from "jotai";
import {
  activeHistoryIdAtom,
  activeHistoryPrevIdAtom,
  historyAtoms,
} from "@/features/page-history/atoms/history-atoms";
import HistoryView from "@/features/page-history/components/history-view";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { IconCheck } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { usePageHistoryListQuery } from "@/features/page-history/queries/page-history-query";
import { formattedDate } from "@/lib/time";
import {
  useDiffNavigation,
  useHistoryReset,
  useHistoryRestore,
} from "@/features/page-history/hooks";
import HistoryToolbar from "./history-toolbar";
import HistoryStatusNotice from "./history-status";
import classes from "./css/history-mobile.module.css";

interface Props {
  pageId: string;
  pageTitle?: string;
}

export default function HistoryModalMobile({ pageId, pageTitle }: Props) {
  const { t } = useTranslation();

  const [activeHistoryId, setActiveHistoryId] = useAtom(activeHistoryIdAtom);
  const [activeHistoryPrevId, setActiveHistoryPrevId] = useAtom(
    activeHistoryPrevIdAtom,
  );
  const setHistoryModalOpen = useSetAtom(historyAtoms);

  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const dropdownViewportRef = useRef<HTMLDivElement>(null);

  const {
    data: pageHistoryData,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = usePageHistoryListQuery(pageId);

  const historyItems = useMemo(
    () => pageHistoryData?.pages.flatMap((page) => page.items) ?? [],
    [pageHistoryData],
  );

  const selectData = useMemo(
    () =>
      historyItems.map((item) => {
        const contributors = item.contributors;
        const hasContributors = contributors && contributors.length > 0;
        const names = hasContributors
          ? contributors.map((c) => c.name).join(", ")
          : item.lastUpdatedBy?.name;
        return {
          value: item.id,
          label: formattedDate(new Date(item.createdAt)),
          userName: names,
        };
      }),
    [historyItems],
  );

  useHistoryReset(pageId);
  const { canRestore, confirmRestore } = useHistoryRestore();
  const { currentChangeIndex, handlePrevChange, handleNextChange } =
    useDiffNavigation(scrollViewportRef);

  useEffect(() => {
    if (historyItems.length > 0 && !activeHistoryId) {
      setActiveHistoryId(historyItems[0].id);
    }
    const index = historyItems.findIndex((item) => item.id === activeHistoryId);
    setActiveHistoryPrevId(historyItems[index >= 0 ? index + 1 : 1]?.id ?? "");
  }, [
    historyItems,
    activeHistoryId,
    setActiveHistoryId,
    setActiveHistoryPrevId,
  ]);

  const handleDropdownScroll = useCallback(() => {
    const viewport = dropdownViewportRef.current;
    if (!viewport || !hasNextPage || isFetchingNextPage) return;

    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const isNearBottom = scrollTop + clientHeight >= scrollHeight - 50;

    if (isNearBottom) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const handleSelectVersion = useCallback(
    (value: string | null) => {
      if (!value) return;
      const index = historyItems.findIndex((item) => item.id === value);
      if (index >= 0) {
        setActiveHistoryId(value);
        setActiveHistoryPrevId(historyItems[index + 1]?.id ?? "");
      }
    },
    [historyItems, setActiveHistoryId, setActiveHistoryPrevId],
  );

  if (isLoading) {
    return null;
  }

  return (
    <Box className={classes.container}>
      <Box className={classes.selectorWrapper}>
        <HistoryStatusNotice status={pageHistoryData?.pages[0]?.status} />
        {isError && <Text>{t("Error loading page history.")}</Text>}
        <Select
          data={selectData}
          value={activeHistoryId}
          onChange={handleSelectVersion}
          placeholder={t("Select version")}
          checkIconPosition="right"
          maxDropdownHeight={300}
          renderOption={({ option, checked }) => (
            <Group justify="space-between" wrap="nowrap" w="100%">
              <div>
                <Text size="sm">{option.label}</Text>
                <Text size="xs" c="dimmed">
                  {(option as { userName?: string }).userName}
                </Text>
              </div>
              {checked && <IconCheck size={16} />}
            </Group>
          )}
          comboboxProps={{ withinPortal: false }}
          scrollAreaProps={{
            viewportRef: dropdownViewportRef,
            onScrollPositionChange: handleDropdownScroll,
          }}
        />
      </Box>

      <ScrollArea
        className={classes.editorArea}
        viewportRef={scrollViewportRef}
        scrollbarSize={5}
      >
        <Box className={classes.editorContent}>
          {activeHistoryId && <HistoryView />}
        </Box>
      </ScrollArea>

      {canRestore && (
        <Group className={classes.actionButtons} justify="flex-end" gap="sm">
          <Button variant="default" onClick={() => setHistoryModalOpen(false)}>
            {t("Cancel")}
          </Button>
          <Button onClick={confirmRestore}>{t("Restore")}</Button>
        </Group>
      )}

      {activeHistoryId && activeHistoryPrevId && (
        <HistoryToolbar
          index={currentChangeIndex}
          previous={handlePrevChange}
          next={handleNextChange}
        />
      )}
    </Box>
  );
}
