export const AI_PROVIDER_TYPES = [
  "ollama",
  "openai",
  "openai-compatible",
] as const;

export type AiProviderType = (typeof AI_PROVIDER_TYPES)[number];

export const AI_TASK_CLASSES = [
  "text-generation",
  "streaming-generation",
  "grounded-answer-generation",
  "embeddings-indexing-preparation",
] as const;

export type AiTaskClass = (typeof AI_TASK_CLASSES)[number];

export interface AiProvider {
  id: string;
  name: string;
  type: AiProviderType;
  baseUrl: string | null;
  apiKeyEnvVar: string | null;
  isEnabled: boolean;
  capabilityFlags?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string | null;
}

export interface AiModel {
  id: string;
  name: string;
  modelId: string;
  providerId: string;
  providerName?: string;
  providerType?: AiProviderType;
  isEnabled: boolean;
  capabilityFlags?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string | null;
}

export interface AiTaskRoute {
  id: string;
  taskClass: AiTaskClass;
  routeOptions?: Record<string, unknown>;
  aiModelId: string;
  modelName: string;
  modelRef: string;
  providerId: string;
  providerName: string;
  providerType: AiProviderType;
}

export interface AiProviderHealthCheck {
  providerId: string;
  providerName: string;
  providerType: AiProviderType;
  checkedAt: string;
  latencyMs: number;
  healthy: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export type AiProviderHealthResponse =
  | AiProviderHealthCheck
  | { checks: AiProviderHealthCheck[] };

export interface CreateAiProviderPayload {
  name: string;
  type: AiProviderType;
  baseUrl?: string;
  apiKeyEnvVar?: string;
  isEnabled?: boolean;
}

export interface UpdateAiProviderPayload {
  providerId: string;
  name?: string;
  baseUrl?: string;
  apiKeyEnvVar?: string;
  isEnabled?: boolean;
}

export interface CreateAiModelPayload {
  providerId: string;
  name: string;
  modelId: string;
  isEnabled?: boolean;
  defaultTaskClasses?: AiTaskClass[];
}

export interface UpdateAiModelPayload {
  aiModelId: string;
  name?: string;
  modelId?: string;
  isEnabled?: boolean;
  defaultTaskClasses?: AiTaskClass[];
}

export interface UpsertAiTaskRoutesPayload {
  routes: Array<{
    taskClass: AiTaskClass;
    aiModelId: string;
    routeOptions?: Record<string, unknown>;
  }>;
}
