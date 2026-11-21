import {
  InfiniteData,
  useInfiniteQuery,
  UseInfiniteQueryResult,
  useQuery,
  UseQueryResult,
} from "@tanstack/react-query";
import {
  getPageHistoryById,
  getPageHistoryList,
} from "@/features/page-history/services/page-history-service";
import {
  IPageHistory,
  HistoryStatus,
} from "@/features/page-history/types/page.types";
import { IPagination } from "@/lib/types.ts";
import { queryClient } from "@/main";

import { useAtomValue } from "jotai";
import { historyAtoms } from "../atoms/history-atoms";

export type HistoryListResult = IPagination<IPageHistory> & {
  status?: HistoryStatus;
};

const HISTORY_STALE_TIME = 60 * 60 * 1000;

export function prefetchPageHistory(historyId: string) {
  return queryClient.prefetchQuery({
    queryKey: ["page-history", historyId],
    queryFn: () => getPageHistoryById(historyId),
    staleTime: HISTORY_STALE_TIME,
  });
}

export function usePageHistoryListQuery(
  pageId: string,
): UseInfiniteQueryResult<InfiniteData<HistoryListResult, unknown>> {
  const opened = useAtomValue(historyAtoms);
  return useInfiniteQuery({
    queryKey: ["page-history-list", pageId],
    queryFn: ({ pageParam }) => getPageHistoryList(pageId, pageParam),
    enabled: !!pageId && opened,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: opened ? 5000 : false,
    gcTime: 0,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.meta?.nextCursor ?? undefined,
  });
}

export function usePageHistoryQuery(
  historyId: string,
): UseQueryResult<IPageHistory, Error> {
  return useQuery({
    queryKey: ["page-history", historyId],
    queryFn: () => getPageHistoryById(historyId),
    enabled: !!historyId,
    staleTime: HISTORY_STALE_TIME,
  });
}
