import { isDeepStrictEqual } from 'node:util';

export const HISTORY_INTERVAL = 5 * 60 * 1000;
export const HISTORY_FAST_INTERVAL = 60 * 1000;
export const HISTORY_FAST_THRESHOLD = 5 * 60 * 1000;

export function historyDelay(createdAt: Date | string): number {
  return Date.now() - new Date(createdAt).getTime() < HISTORY_FAST_THRESHOLD
    ? HISTORY_FAST_INTERVAL
    : HISTORY_INTERVAL;
}

/** Metadata is versioned too; attribution alone does not create a new version. */
export function sameHistoryState(a: any, b: any): boolean {
  return (
    !!a &&
    !!b &&
    ['title', 'content', 'icon', 'coverPhoto'].every((field) =>
      isDeepStrictEqual(a[field] ?? null, b[field] ?? null),
    )
  );
}
