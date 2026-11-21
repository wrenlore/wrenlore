export { useHistoryReset } from "../../apps/client/src/features/page-history/hooks/use-history-reset";
export { useDiffNavigation } from "../../apps/client/src/features/page-history/hooks/use-diff-navigation";
export const useHistoryRestore = () => ({
  canRestore: true,
  confirmRestore: () => {
    throw new Error("Restore is disabled in the synthetic UI fixture");
  },
});
