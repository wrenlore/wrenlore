import api from "@/lib/api-client";
import {
  AiAction,
  AiContentResponse,
  AiGenerateDto,
  AiStreamChunk,
  AiStreamError,
} from "@/wrenlore/ai/types/ai.types";

interface GenerateTextRequest {
  prompt: string;
}

function buildPrompt(data: AiGenerateDto): string {
  const selectedContent = data.content?.trim();
  const customPrompt = data.prompt?.trim();

  if (data.action === AiAction.CUSTOM) {
    if (!customPrompt && selectedContent) {
      return selectedContent;
    }
    if (!customPrompt) {
      return "";
    }
    if (!selectedContent) {
      return customPrompt;
    }
    return `${customPrompt}\n\nContext:\n${selectedContent}`;
  }

  if (!selectedContent) {
    if (customPrompt) {
      return customPrompt;
    }
    return "Write a concise paragraph.";
  }

  switch (data.action) {
    case AiAction.IMPROVE_WRITING:
      return `Improve the writing of the following text while preserving meaning:\n\n${selectedContent}`;
    case AiAction.MAKE_SHORTER:
      return `Rewrite the following text to be shorter and clearer:\n\n${selectedContent}`;
    case AiAction.MAKE_LONGER:
      return `Expand the following text with more detail while keeping the same intent:\n\n${selectedContent}`;
    case AiAction.SUMMARIZE:
      return `Summarize the following text:\n\n${selectedContent}`;
    case AiAction.CONTINUE_WRITING:
      return `Continue writing from this text:\n\n${selectedContent}`;
    default:
      if (customPrompt) {
        return `${customPrompt}\n\nText:\n${selectedContent}`;
      }
      return selectedContent;
  }
}

function toGenerateTextRequest(data: AiGenerateDto): GenerateTextRequest {
  return {
    prompt: buildPrompt(data),
  };
}

export async function generateAiContent(
  data: AiGenerateDto,
): Promise<AiContentResponse> {
  const req = await api.post<AiContentResponse>(
    "/wren-ai/generate",
    toGenerateTextRequest(data),
  );
  return req.data;
}

export async function generateAiContentStream(
  data: AiGenerateDto,
  onChunk: (chunk: AiStreamChunk) => void,
  onError?: (error: AiStreamError) => void,
  onComplete?: () => void,
): Promise<AbortController> {
  const abortController = new AbortController();
  const requestPayload = toGenerateTextRequest(data);
  try {
    const response = await fetch("/api/wren-ai/generate/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
      signal: abortController.signal,
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const processStream = async () => {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");

          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                onComplete?.();
                return;
              }
              try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                  onError?.(parsed);
                } else {
                  onChunk(parsed);
                }
              } catch {
                // Ignore partial or malformed stream frames.
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          onError?.({ error: error.message });
        }
      } finally {
        reader.releaseLock();
      }
    };

    processStream();
  } catch (error) {
    onError?.({
      error: error instanceof Error ? error.message : "Unknown AI stream error",
    });
  }

  return abortController;
}
