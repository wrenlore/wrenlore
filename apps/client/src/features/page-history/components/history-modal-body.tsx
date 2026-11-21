import { ScrollArea } from "@mantine/core";
import HistoryList from "./history-list";
import HistoryView from "./history-view";
import HistoryToolbar from "./history-toolbar";
import classes from "./css/history.module.css";
import { useAtomValue } from "jotai";
import {
  activeHistoryIdAtom,
  activeHistoryPrevIdAtom,
} from "../atoms/history-atoms";
import { useRef } from "react";
import { useDiffNavigation, useHistoryReset } from "../hooks";
export default function HistoryModalBody({ pageId }: { pageId: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const active = useAtomValue(activeHistoryIdAtom);
  const previous = useAtomValue(activeHistoryPrevIdAtom);
  useHistoryReset(pageId);
  const nav = useDiffNavigation(viewport);
  return (
    <div className={classes.sidebarFlex}>
      <nav className={classes.sidebar}>
        <div className={classes.sidebarMain}>
          <HistoryList pageId={pageId} />
        </div>
      </nav>
      <div className={classes.preview}>
        <ScrollArea
          className={classes.scroller}
          scrollbarSize={5}
          viewportRef={viewport}
        >
          <div className={classes.sidebarRightSection}>
            {active && <HistoryView />}
          </div>
        </ScrollArea>
        {active && previous && (
          <HistoryToolbar
            index={nav.currentChangeIndex}
            previous={nav.handlePrevChange}
            next={nav.handleNextChange}
          />
        )}
      </div>
    </div>
  );
}
