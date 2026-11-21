import { Group, Loader, Paper, ScrollArea, Text } from "@mantine/core";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { memo, useLayoutEffect, useRef } from "react";
import classes from "./ai-menu.module.css";

interface ResultPreviewProps {
  output: string;
  isLoading: boolean;
  statusText?: string | null;
}

// Distance from the bottom (px) that still counts as "at the bottom", so
// streamed lines and subpixel rounding do not drop follow mode.
const FOLLOW_BOTTOM_THRESHOLD = 32;

const isNearBottom = (viewport: HTMLElement): boolean =>
  viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
  FOLLOW_BOTTOM_THRESHOLD;

const ResultPreview = memo(
  ({ output, isLoading, statusText }: ResultPreviewProps) => {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const followingRef = useRef(true);
    const previousOutputRef = useRef("");

    // Follow new streamed text while the user is at (or near) the bottom.
    // Scrolling up pauses following; returning to the bottom resumes it,
    // because every scroll event re-evaluates the position. A shrinking
    // output means a new generation started, which resets follow mode.
    // Scrolling the viewport never touches document scroll or focus.
    useLayoutEffect(() => {
      if (output.length < previousOutputRef.current.length) {
        followingRef.current = true;
      }
      previousOutputRef.current = output;

      const viewport = viewportRef.current;
      if (viewport && followingRef.current) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }, [output, isLoading, statusText]);

    if (!output && !isLoading && !statusText) return;

    const parsedOutput = `${marked.parse(output)}`;

    return (
      <Paper mb={4} shadow="lg" radius="md" className={classes.resultPreview}>
        <ScrollArea.Autosize
          mah={300}
          type="scroll"
          scrollbarSize={5}
          viewportRef={viewportRef}
          onScrollPositionChange={() => {
            const viewport = viewportRef.current;
            if (viewport) {
              followingRef.current = isNearBottom(viewport);
            }
          }}
        >
          <div className={classes.resultPreviewWrapper}>
            {statusText && !output && (
              <Group gap="xs" wrap="nowrap">
                <Loader size={12} />
                <Text size="xs" c="dimmed">
                  {statusText}
                </Text>
              </Group>
            )}
            {parsedOutput && (
              <div
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(parsedOutput),
                }}
              />
            )}
            {isLoading && <Loader size={12} ml="xs" display="inline-block" />}
          </div>
        </ScrollArea.Autosize>
      </Paper>
    );
  },
);

export { ResultPreview };
