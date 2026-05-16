import api from "@/lib/api-client";
import {
  AiModel,
  AiProvider,
  AiProviderHealthResponse,
  AiTaskRoute,
  CreateAiModelPayload,
  CreateAiProviderPayload,
  UpdateAiModelPayload,
  UpdateAiProviderPayload,
  UpsertAiTaskRoutesPayload,
} from "@/wrenlore/ai/types/ai-admin.types";

export async function listAiProviders(): Promise<AiProvider[]> {
  const req = await api.post<AiProvider[]>("/wren-ai/admin/providers/list");
  return req.data;
}

export async function createAiProvider(
  data: CreateAiProviderPayload,
): Promise<AiProvider> {
  const req = await api.post<AiProvider>(
    "/wren-ai/admin/providers/create",
    data,
  );
  return req.data;
}

export async function updateAiProvider(
  data: UpdateAiProviderPayload,
): Promise<AiProvider> {
  const req = await api.post<AiProvider>(
    "/wren-ai/admin/providers/update",
    data,
  );
  return req.data;
}

export async function deleteAiProvider(providerId: string): Promise<void> {
  await api.post("/wren-ai/admin/providers/delete", { providerId });
}

export async function listAiModels(params?: {
  providerId?: string;
}): Promise<AiModel[]> {
  const req = await api.post<AiModel[]>(
    "/wren-ai/admin/models/list",
    params ?? {},
  );
  return req.data;
}

export async function createAiModel(data: CreateAiModelPayload): Promise<AiModel> {
  const req = await api.post<AiModel>("/wren-ai/admin/models/create", data);
  return req.data;
}

export async function updateAiModel(data: UpdateAiModelPayload): Promise<AiModel> {
  const req = await api.post<AiModel>("/wren-ai/admin/models/update", data);
  return req.data;
}

export async function deleteAiModel(aiModelId: string): Promise<void> {
  await api.post("/wren-ai/admin/models/delete", { aiModelId });
}

export async function listAiTaskRoutes(): Promise<AiTaskRoute[]> {
  const req = await api.post<AiTaskRoute[]>(
    "/wren-ai/admin/task-routes/list",
  );
  return req.data;
}

export async function upsertAiTaskRoutes(
  data: UpsertAiTaskRoutesPayload,
): Promise<AiTaskRoute[]> {
  const req = await api.post<AiTaskRoute[]>(
    "/wren-ai/admin/task-routes/upsert",
    data,
  );
  return req.data;
}

export async function checkAiProviderHealth(params?: {
  providerId?: string;
  aiModelId?: string;
}): Promise<AiProviderHealthResponse> {
  const req = await api.post<AiProviderHealthResponse>(
    "/wren-ai/admin/providers/health",
    params ?? {},
  );
  return req.data;
}
