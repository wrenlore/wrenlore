import { useAtomValue } from "jotai";
import { RefObject, useCallback, useEffect, useState } from "react";
import { diffCountsAtom } from "@/features/page-history/atoms/history-atoms";

/**
 * Manages navigation between diff changes in the history view.
 * Provides prev/next handlers and auto-scrolls to the current change.
 */
export function useDiffNavigation(
  scrollViewportRef: RefObject<HTMLDivElement>,
) {
  const diffCounts = useAtomValue(diffCountsAtom);
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);

  const scrollToChangeIndex = useCallback(
    (index: number) => {
      const viewport = scrollViewportRef.current;
      if (!viewport || index < 1) return;

      const element = viewport.querySelector(`[data-diff-index="${index}"]`);
      if (element instanceof HTMLElement) {
        // offsetTop can be relative to a positioned table cell or another
        // nested block. Convert screen coordinates to this scroll viewport.
        const elementRect = element.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();
        const scrollTarget =
          viewport.scrollTop +
          elementRect.top -
          viewportRect.top -
          viewport.clientTop -
          viewport.clientHeight / 2 +
          elementRect.height / 2;
        viewport.scrollTo({ top: scrollTarget, behavior: "smooth" });
      }
    },
    [scrollViewportRef],
  );

  useEffect(() => {
    if (diffCounts && diffCounts.total > 0) {
      setCurrentChangeIndex(1);
      requestAnimationFrame(() => scrollToChangeIndex(1));
    } else {
      setCurrentChangeIndex(0);
    }
  }, [diffCounts, scrollToChangeIndex]);

  const handlePrevChange = useCallback(() => {
    if (!diffCounts || diffCounts.total === 0) return;
    const newIndex =
      currentChangeIndex <= 1 ? diffCounts.total : currentChangeIndex - 1;
    setCurrentChangeIndex(newIndex);
    scrollToChangeIndex(newIndex);
  }, [diffCounts, currentChangeIndex, scrollToChangeIndex]);

  const handleNextChange = useCallback(() => {
    if (!diffCounts || diffCounts.total === 0) return;
    const newIndex =
      currentChangeIndex >= diffCounts.total ? 1 : currentChangeIndex + 1;
    setCurrentChangeIndex(newIndex);
    scrollToChangeIndex(newIndex);
  }, [diffCounts, currentChangeIndex, scrollToChangeIndex]);

  return { currentChangeIndex, handlePrevChange, handleNextChange };
}
