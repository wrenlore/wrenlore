import type { HistoryListResult } from "../queries/page-history-query";
import api from "@/lib/api-client";
import { IPageHistory } from "@/features/page-history/types/page.types";

export async function getPageHistoryList(
  pageId: string,
  cursor?: string,
): Promise<HistoryListResult> {
  const req = await api.post("/pages/history", {
    pageId,
    cursor,
  });
  return req.data;
}

export async function getPageHistoryById(
  historyId: string,
): Promise<IPageHistory> {
  const req = await api.post<IPageHistory>("/pages/history/info", {
    historyId,
  });
  return req.data;
}
