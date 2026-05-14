import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import {
  AI_DEFAULT_OLLAMA_BASE_URL,
  AI_DEFAULT_OPENAI_BASE_URL,
} from './ai.constants';
import {
  AiGenerateRequest,
  AiGeneratedEmbeddings,
  AiGeneratedText,
  AiProviderHealth,
  AiResolvedRoute,
  AiUsage,
} from './ai.types';

@Injectable()
export class AiProviderGatewayService {
  async generateText(
    route: AiResolvedRoute,
    dto: AiGenerateRequest,
  ): Promise<AiGeneratedText> {
    if (route.provider.type === 'ollama') {
      return this.generateOllamaText(route, dto);
    }

    return this.generateOpenAiLikeText(route, dto);
  }

  async *streamText(
    route: AiResolvedRoute,
    dto: AiGenerateRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    if (route.provider.type === 'ollama') {
      yield* this.streamOllamaText(route, dto, signal);
      return;
    }

    yield* this.streamOpenAiLikeText(route, dto, signal);
  }

  async generateEmbeddings(
    route: AiResolvedRoute,
    input: string[],
  ): Promise<AiGeneratedEmbeddings> {
    if (route.provider.type === 'ollama') {
      return this.generateOllamaEmbeddings(route, input);
    }

    return this.generateOpenAiLikeEmbeddings(route, input);
  }

  async verifyProviderHealth(
    provider: {
      id: string;
      name: string;
      type: string;
      baseUrl: string | null;
      apiKeyEnvVar: string | null;
    },
    opts?: {
      modelId?: string;
    },
  ): Promise<AiProviderHealth> {
    const started = performance.now();
    const checkedAt = new Date().toISOString();

    try {
      if (provider.type === 'ollama') {
        const baseUrl = this.getProviderBaseUrl(provider.type, provider.baseUrl);
        const tags = await this.requestJson(
          this.joinUrl(baseUrl, '/api/tags'),
          {
            method: 'GET',
          },
        );

        if (opts?.modelId) {
          const modelNames: string[] = (tags?.models ?? [])
            .map((m: any) => m?.name)
            .filter(Boolean);

          if (!modelNames.includes(opts.modelId)) {
            return {
              providerId: provider.id,
              providerName: provider.name,
              providerType: provider.type,
              checkedAt,
              latencyMs: this.roundLatency(started),
              healthy: false,
              error: `Model "${opts.modelId}" not found in Ollama tags.`,
              details: {
                discoveredModels: modelNames.slice(0, 50),
              },
            };
          }
        }

        return {
          providerId: provider.id,
          providerName: provider.name,
          providerType: provider.type,
          checkedAt,
          latencyMs: this.roundLatency(started),
          healthy: true,
          details: {
            baseUrl,
            modelsCount: Array.isArray(tags?.models) ? tags.models.length : 0,
          },
        };
      }

      const baseUrl = this.getProviderBaseUrl(provider.type, provider.baseUrl);
      const apiKey = this.resolveApiKey(provider.type, provider.apiKeyEnvVar);
      const headers = this.openAiLikeHeaders(apiKey);

      if (opts?.modelId) {
        await this.requestJson(this.joinUrl(baseUrl, '/chat/completions'), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: opts.modelId,
            messages: [{ role: 'user', content: 'Respond with "ok".' }],
            max_tokens: 4,
            temperature: 0,
          }),
        });
      } else {
        await this.requestJson(this.joinUrl(baseUrl, '/models'), {
          method: 'GET',
          headers,
        });
      }

      return {
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.type,
        checkedAt,
        latencyMs: this.roundLatency(started),
        healthy: true,
        details: {
          baseUrl,
          checkedModelId: opts?.modelId ?? null,
        },
      };
    } catch (err) {
      return {
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.type,
        checkedAt,
        latencyMs: this.roundLatency(started),
        healthy: false,
        error: err instanceof Error ? err.message : 'Unknown provider error',
      };
    }
  }

  private async generateOpenAiLikeText(
    route: AiResolvedRoute,
    dto: AiGenerateRequest,
  ): Promise<AiGeneratedText> {
    const baseUrl = this.getProviderBaseUrl(
      route.provider.type,
      route.provider.baseUrl,
    );
    const apiKey = this.resolveApiKey(
      route.provider.type,
      route.provider.apiKeyEnvVar,
    );
    const payload = await this.requestJson(
      this.joinUrl(baseUrl, '/chat/completions'),
      {
        method: 'POST',
        headers: this.openAiLikeHeaders(apiKey),
        body: JSON.stringify({
          model: route.model.modelId,
          messages: this.toMessages(dto),
          temperature: dto.temperature,
          max_tokens: dto.maxTokens,
          stream: false,
        }),
      },
    );

    return {
      content: this.extractOpenAiLikeContent(payload),
      usage: this.extractOpenAiLikeUsage(payload),
    };
  }

  private async generateOllamaText(
    route: AiResolvedRoute,
    dto: AiGenerateRequest,
  ): Promise<AiGeneratedText> {
    const baseUrl = this.getProviderBaseUrl(
      route.provider.type,
      route.provider.baseUrl,
    );

    const payload = await this.requestJson(this.joinUrl(baseUrl, '/api/chat'), {
      method: 'POST',
      headers: this.ollamaHeaders(route.provider.apiKeyEnvVar),
      body: JSON.stringify({
        model: route.model.modelId,
        messages: this.toMessages(dto),
        stream: false,
        options: this.ollamaOptions(dto),
      }),
    });

    return {
      content: payload?.message?.content ?? '',
      usage: this.extractOllamaUsage(payload),
    };
  }

  private async *streamOpenAiLikeText(
    route: AiResolvedRoute,
    dto: AiGenerateRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const baseUrl = this.getProviderBaseUrl(
      route.provider.type,
      route.provider.baseUrl,
    );
    const apiKey = this.resolveApiKey(
      route.provider.type,
      route.provider.apiKeyEnvVar,
    );

    const response = await fetch(this.joinUrl(baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: this.openAiLikeHeaders(apiKey),
      body: JSON.stringify({
        model: route.model.modelId,
        messages: this.toMessages(dto),
        temperature: dto.temperature,
        max_tokens: dto.maxTokens,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadGatewayException(
        `Provider stream request failed: ${response.status} ${errorText}`,
      );
    }

    if (!response.body) {
      throw new BadGatewayException('Provider stream body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            yield delta;
          }
        } catch (err) {
          // Ignore malformed stream chunks and continue.
        }
      }
    }
  }

  private async *streamOllamaText(
    route: AiResolvedRoute,
    dto: AiGenerateRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const baseUrl = this.getProviderBaseUrl(
      route.provider.type,
      route.provider.baseUrl,
    );

    const response = await fetch(this.joinUrl(baseUrl, '/api/chat'), {
      method: 'POST',
      headers: this.ollamaHeaders(route.provider.apiKeyEnvVar),
      body: JSON.stringify({
        model: route.model.modelId,
        messages: this.toMessages(dto),
        stream: true,
        options: this.ollamaOptions(dto),
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadGatewayException(
        `Provider stream request failed: ${response.status} ${errorText}`,
      );
    }

    if (!response.body) {
      throw new BadGatewayException('Provider stream body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const json = JSON.parse(trimmed);
          const delta = json?.message?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            yield delta;
          }
        } catch (err) {
          // Ignore malformed stream chunks and continue.
        }
      }
    }
  }

  private async generateOpenAiLikeEmbeddings(
    route: AiResolvedRoute,
    input: string[],
  ): Promise<AiGeneratedEmbeddings> {
    const baseUrl = this.getProviderBaseUrl(
      route.provider.type,
      route.provider.baseUrl,
    );
    const apiKey = this.resolveApiKey(
      route.provider.type,
      route.provider.apiKeyEnvVar,
    );

    const payload = await this.requestJson(this.joinUrl(baseUrl, '/embeddings'), {
      method: 'POST',
      headers: this.openAiLikeHeaders(apiKey),
      body: JSON.stringify({
        model: route.model.modelId,
        input,
      }),
    });

    const vectors: number[][] = Array.isArray(payload?.data)
      ? payload.data
          .map((row: any) => row?.embedding)
          .filter((embedding: any) => Array.isArray(embedding))
      : [];

    if (vectors.length === 0) {
      throw new BadGatewayException(
        'Provider did not return embeddings for the requested input.',
      );
    }

    return {
      vectors,
      dimensions: vectors[0]?.length ?? 0,
    };
  }

  private async generateOllamaEmbeddings(
    route: AiResolvedRoute,
    input: string[],
  ): Promise<AiGeneratedEmbeddings> {
    const baseUrl = this.getProviderBaseUrl(
      route.provider.type,
      route.provider.baseUrl,
    );
    const headers = this.ollamaHeaders(route.provider.apiKeyEnvVar);

    try {
      const payload = await this.requestJson(this.joinUrl(baseUrl, '/api/embed'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: route.model.modelId,
          input,
        }),
      });

      if (Array.isArray(payload?.embeddings) && payload.embeddings.length > 0) {
        return {
          vectors: payload.embeddings as number[][],
          dimensions: payload.embeddings[0]?.length ?? 0,
        };
      }
    } catch (err) {
      // Fallback below for older Ollama embedding APIs.
    }

    const vectors: number[][] = [];
    for (const text of input) {
      const payload = await this.requestJson(
        this.joinUrl(baseUrl, '/api/embeddings'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: route.model.modelId,
            prompt: text,
          }),
        },
      );

      if (Array.isArray(payload?.embedding)) {
        vectors.push(payload.embedding);
      }
    }

    if (vectors.length === 0) {
      throw new BadGatewayException(
        'Ollama provider did not return embeddings for the requested input.',
      );
    }

    return {
      vectors,
      dimensions: vectors[0]?.length ?? 0,
    };
  }

  private toMessages(dto: AiGenerateRequest) {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (dto.systemPrompt) {
      messages.push({
        role: 'system',
        content: dto.systemPrompt,
      });
    }

    messages.push({
      role: 'user',
      content: dto.prompt,
    });

    return messages;
  }

  private openAiLikeHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };

    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }

  private ollamaHeaders(apiKeyEnvVar?: string | null): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };

    if (apiKeyEnvVar) {
      const apiKey = this.resolveApiKey('openai-compatible', apiKeyEnvVar);
      headers.authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }

  private getProviderBaseUrl(type: string, baseUrl: string | null): string {
    if (type === 'openai') {
      return baseUrl || AI_DEFAULT_OPENAI_BASE_URL;
    }

    if (type === 'ollama') {
      return baseUrl || AI_DEFAULT_OLLAMA_BASE_URL;
    }

    if (!baseUrl) {
      throw new BadRequestException(
        `Provider type "${type}" requires a base URL.`,
      );
    }

    return baseUrl;
  }

  private resolveApiKey(type: string, apiKeyEnvVar: string | null): string {
    if (!apiKeyEnvVar && type === 'openai') {
      throw new BadRequestException(
        'OpenAI providers must reference an API key environment variable.',
      );
    }

    if (!apiKeyEnvVar) {
      return undefined;
    }

    const value = process.env[apiKeyEnvVar];
    if (!value) {
      throw new BadRequestException(
        `Referenced API key env var "${apiKeyEnvVar}" is not set.`,
      );
    }

    return value;
  }

  private async requestJson(url: string, init: RequestInit): Promise<any> {
    const response = await fetch(url, init);
    if (!response.ok) {
      const errorText = await response.text();
      throw new BadGatewayException(
        `Provider request failed: ${response.status} ${errorText}`,
      );
    }

    try {
      return await response.json();
    } catch (err) {
      throw new BadGatewayException('Provider returned invalid JSON response.');
    }
  }

  private joinUrl(baseUrl: string, path: string): string {
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  private extractOpenAiLikeContent(payload: any): string {
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('');
    }

    return '';
  }

  private extractOpenAiLikeUsage(payload: any): AiUsage {
    const usage = payload?.usage;
    if (!usage) return;

    return {
      promptTokens: usage.prompt_tokens ?? usage.promptTokens,
      completionTokens: usage.completion_tokens ?? usage.completionTokens,
      totalTokens: usage.total_tokens ?? usage.totalTokens,
    };
  }

  private extractOllamaUsage(payload: any): AiUsage {
    if (!payload) return;
    const promptTokens = payload?.prompt_eval_count;
    const completionTokens = payload?.eval_count;
    const hasCounts =
      typeof promptTokens === 'number' || typeof completionTokens === 'number';

    if (!hasCounts) return;

    return {
      promptTokens,
      completionTokens,
      totalTokens:
        (typeof promptTokens === 'number' ? promptTokens : 0) +
        (typeof completionTokens === 'number' ? completionTokens : 0),
    };
  }

  private ollamaOptions(dto: AiGenerateRequest) {
    const options: Record<string, any> = {};
    if (typeof dto.temperature === 'number') {
      options.temperature = dto.temperature;
    }
    if (typeof dto.maxTokens === 'number') {
      options.num_predict = dto.maxTokens;
    }
    return Object.keys(options).length ? options : undefined;
  }

  private roundLatency(started: number): number {
    return Math.round((performance.now() - started) * 100) / 100;
  }
}
