import { Spotlight } from "@mantine/spotlight";
import { Anchor, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import { IAiSearchResponse } from "@/wrenlore/ai/types/ai.types";
import { buildPageUrl } from "@/features/page/page.utils";

const AI_ANSWERS_EMPTY_SOURCES_MESSAGE =
  "No relevant indexed workspace sources were found for this query.";

export function AiSearchResult({
  result,
  isLoading,
  streamingAnswer,
  streamingSources,
}: {
  result?: IAiSearchResponse;
  isLoading?: boolean;
  streamingAnswer?: string;
  streamingSources?: IAiSearchResponse["citations"];
}) {
  const answer =
    streamingAnswer ||
    result?.answer ||
    (result?.status === "empty_sources" ? AI_ANSWERS_EMPTY_SOURCES_MESSAGE : "");
  const sources = streamingSources || result?.citations || [];

  return (
    <Spotlight.Action closeSpotlightOnTrigger={false}>
      <Stack gap="xs">
        <Text size="sm" fw={600}>AI answer</Text>
        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
          {isLoading && !answer
            ? "Generating answer..."
            : answer || "AI Answers did not return a usable response for this query."}
        </Text>
        {sources.length > 0 && (
          <Stack gap={2}>
            {sources.map((source, index) => (
              <Anchor
                key={`${source.pageId ?? index}`}
                size="xs"
                component={Link}
                to={buildPageUrl(source.spaceSlug, source.slugId, source.title)}
              >
                {source.title || "Source"}
              </Anchor>
            ))}
          </Stack>
        )}
      </Stack>
    </Spotlight.Action>
  );
}
