import { useMutation } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { aiAnswers } from "@/wrenlore/ai/services/ai-search-service";
import { IAiSearchResponse } from "@/wrenlore/ai/types/ai.types";

export function useAiSearch() {
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [streamingSources, setStreamingSources] = useState<IAiSearchResponse["citations"]>([]);
  const clearStreaming = useCallback(() => {
    setStreamingAnswer("");
    setStreamingSources([]);
  }, []);

  const mutation = useMutation({
    mutationFn: aiAnswers,
    onSuccess: (data) => {
      setStreamingAnswer(data.answer ?? "");
      setStreamingSources(data.citations ?? []);
    },
  });

  return {
    ...mutation,
    streamingAnswer,
    streamingSources,
    clearStreaming,
  };
}
