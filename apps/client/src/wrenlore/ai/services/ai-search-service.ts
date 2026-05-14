import api from "@/lib/api-client";
import { IAiSearchResponse } from "@/wrenlore/ai/types/ai.types";

export async function aiAnswers(params: {
  query: string;
  spaceId?: string | null;
}): Promise<IAiSearchResponse> {
  const req = await api.post<IAiSearchResponse>("/wren-ai/grounded-answer", {
    query: params.query,
    spaceId: params.spaceId || undefined,
  });
  return req.data;
}
