import { useMutation } from "@tanstack/react-query";
import {
  generateAiContent,
  generateAiContentStream,
} from "@/wrenlore/ai/services/ai-service";
import {
  AiContentResponse,
  AiGenerateDto,
  AiStreamChunk,
  AiStreamError,
} from "@/wrenlore/ai/types/ai.types";

export function useAiGenerateMutation() {
  return useMutation({
    mutationFn: (data: AiGenerateDto): Promise<AiContentResponse> =>
      generateAiContent(data),
  });
}

interface StreamCallbacks {
  onChunk: (chunk: AiStreamChunk) => void;
  onError?: (error: AiStreamError) => void;
  onComplete?: () => void;
}

export function useAiGenerateStreamMutation() {
  return useMutation({
    mutationFn: ({ onChunk, onError, onComplete, ...data }: AiGenerateDto & StreamCallbacks) =>
      generateAiContentStream(data, onChunk, onError, onComplete),
  });
}
