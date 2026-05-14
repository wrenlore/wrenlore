export const AI_PROVIDER_TYPES = [
  'openai',
  'openai-compatible',
  'ollama',
] as const;

export type AiProviderType = (typeof AI_PROVIDER_TYPES)[number];

export const AI_TASK_CLASSES = [
  'text-generation',
  'streaming-generation',
  'grounded-answer-generation',
  'embeddings-indexing-preparation',
] as const;

export type AiTaskClass = (typeof AI_TASK_CLASSES)[number];

export const AI_TASK_CLASS_FALLBACKS: Partial<Record<AiTaskClass, AiTaskClass[]>> =
  {
    'streaming-generation': ['text-generation'],
  };

export const AI_DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const AI_DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
