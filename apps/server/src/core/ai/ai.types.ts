import { AiModel, AiProvider } from '@wrenlore/db/types/entity.types';
import { AiTaskClass } from './ai.constants';

export interface AiResolvedRoute {
  requestedTaskClass: AiTaskClass;
  resolvedTaskClass: AiTaskClass;
  routeId: string;
  routeOptions: Record<string, any>;
  provider: AiProvider;
  model: AiModel;
}

export interface AiGenerateRequest {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AiGeneratedText {
  content: string;
  usage?: AiUsage;
}

export interface AiGeneratedEmbeddings {
  vectors: number[][];
  dimensions: number;
}

export interface AiCitation {
  sourceId: string;
  pageId: string;
  slugId: string;
  title: string;
  spaceId?: string;
  spaceSlug?: string;
  spaceName?: string;
  rank: number;
  excerpt?: string;
}

export interface AiProviderHealth {
  providerId: string;
  providerName: string;
  providerType: string;
  checkedAt: string;
  latencyMs: number;
  healthy: boolean;
  details?: Record<string, any>;
  error?: string;
}

export interface AiDiscoveredModel {
  modelId: string;
  name: string;
  details?: Record<string, any>;
}
