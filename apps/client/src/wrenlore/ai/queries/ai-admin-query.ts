import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkAiProviderHealth,
  createAiModel,
  createAiProvider,
  deleteAiModel,
  deleteAiProvider,
  discoverAiModels,
  listAiModels,
  listAiProviders,
  listAiTaskRoutes,
  updateAiModel,
  updateAiProvider,
  upsertAiTaskRoutes,
} from "@/wrenlore/ai/services/ai-admin-service";
import {
  AiProviderHealthResponse,
  CreateAiModelPayload,
  CreateAiProviderPayload,
  UpdateAiModelPayload,
  UpdateAiProviderPayload,
  UpsertAiTaskRoutesPayload,
} from "@/wrenlore/ai/types/ai-admin.types";

const AI_ADMIN_KEYS = {
  providers: ["wren-ai-admin", "providers"] as const,
  models: (providerId?: string) =>
    ["wren-ai-admin", "models", providerId ?? "all"] as const,
  discoveredModels: (providerId?: string) =>
    ["wren-ai-admin", "discovered-models", providerId ?? "none"] as const,
  routes: ["wren-ai-admin", "task-routes"] as const,
};

function errorMessage(error: Error) {
  const response = (error as { response?: { data?: { message?: string } } })
    .response;
  return response?.data?.message ?? error.message;
}

export function useAiProvidersQuery() {
  return useQuery({
    queryKey: AI_ADMIN_KEYS.providers,
    queryFn: listAiProviders,
  });
}

export function useAiModelsQuery(providerId?: string) {
  return useQuery({
    queryKey: AI_ADMIN_KEYS.models(providerId),
    queryFn: () => listAiModels({ providerId }),
  });
}

export function useDiscoveredAiModelsQuery(providerId?: string) {
  return useQuery({
    queryKey: AI_ADMIN_KEYS.discoveredModels(providerId),
    queryFn: () => discoverAiModels(providerId as string),
    enabled: Boolean(providerId),
    retry: false,
  });
}

export function useAiTaskRoutesQuery() {
  return useQuery({
    queryKey: AI_ADMIN_KEYS.routes,
    queryFn: listAiTaskRoutes,
  });
}

export function useCreateAiProviderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAiProviderPayload) => createAiProvider(data),
    onSuccess: () => {
      notifications.show({ message: "AI provider saved" });
      queryClient.invalidateQueries({ queryKey: AI_ADMIN_KEYS.providers });
    },
    onError: (error: Error) =>
      notifications.show({ message: errorMessage(error), color: "red" }),
  });
}

export function useUpdateAiProviderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateAiProviderPayload) => updateAiProvider(data),
    onSuccess: () => {
      notifications.show({ message: "AI provider updated" });
      queryClient.invalidateQueries({ queryKey: AI_ADMIN_KEYS.providers });
      queryClient.invalidateQueries({ queryKey: ["wren-ai-admin", "models"] });
    },
    onError: (error: Error) =>
      notifications.show({ message: errorMessage(error), color: "red" }),
  });
}

export function useDeleteAiProviderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) => deleteAiProvider(providerId),
    onSuccess: () => {
      notifications.show({ message: "AI provider deleted" });
      queryClient.invalidateQueries({ queryKey: AI_ADMIN_KEYS.providers });
      queryClient.invalidateQueries({ queryKey: ["wren-ai-admin"] });
    },
    onError: (error: Error) =>
      notifications.show({ message: errorMessage(error), color: "red" }),
  });
}

export function useCreateAiModelMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAiModelPayload) => createAiModel(data),
    onSuccess: () => {
      notifications.show({ message: "AI model saved" });
      queryClient.invalidateQueries({ queryKey: ["wren-ai-admin"] });
    },
    onError: (error: Error) =>
      notifications.show({ message: errorMessage(error), color: "red" }),
  });
}

export function useUpdateAiModelMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateAiModelPayload) => updateAiModel(data),
    onSuccess: () => {
      notifications.show({ message: "AI model updated" });
      queryClient.invalidateQueries({ queryKey: ["wren-ai-admin"] });
    },
    onError: (error: Error) =>
      notifications.show({ message: errorMessage(error), color: "red" }),
  });
}

export function useDeleteAiModelMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (aiModelId: string) => deleteAiModel(aiModelId),
    onSuccess: () => {
      notifications.show({ message: "AI model deleted" });
      queryClient.invalidateQueries({ queryKey: ["wren-ai-admin"] });
    },
    onError: (error: Error) =>
      notifications.show({ message: errorMessage(error), color: "red" }),
  });
}

export function useUpsertAiTaskRoutesMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpsertAiTaskRoutesPayload) => upsertAiTaskRoutes(data),
    onSuccess: () => {
      notifications.show({ message: "AI task routes updated" });
      queryClient.invalidateQueries({ queryKey: AI_ADMIN_KEYS.routes });
    },
    onError: (error: Error) =>
      notifications.show({ message: errorMessage(error), color: "red" }),
  });
}

export function useAiProviderHealthMutation() {
  return useMutation<
    AiProviderHealthResponse,
    Error,
    { providerId?: string; aiModelId?: string } | undefined
  >({
    mutationFn: (params) => checkAiProviderHealth(params),
    onError: (error: Error) =>
      notifications.show({ message: errorMessage(error), color: "red" }),
  });
}
