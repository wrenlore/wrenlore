import { Group, Loader, Paper, ScrollArea, Text } from "@mantine/core";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { memo } from "react";
import classes from "./ai-menu.module.css";

interface ResultPreviewProps {
  output: string;
  isLoading: boolean;
  statusText?: string | null;
}

const ResultPreview = memo(
  ({ output, isLoading, statusText }: ResultPreviewProps) => {
    if (!output && !isLoading && !statusText) return;

    const parsedOutput = `${marked.parse(output)}`;

    return (
      <Paper mb={4} shadow="lg" radius="md" className={classes.resultPreview}>
        <ScrollArea.Autosize mah={300} type="scroll" scrollbarSize={5}>
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
