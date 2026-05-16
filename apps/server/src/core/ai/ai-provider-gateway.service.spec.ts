import { BadRequestException } from '@nestjs/common';
import { AiProviderGatewayService } from './ai-provider-gateway.service';

describe('AiProviderGatewayService model discovery', () => {
  let service: AiProviderGatewayService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    service = new AiProviderGatewayService({
      decrypt: jest.fn((value: string) => value.replace(/^encrypted:/, '')),
    } as any);
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  function jsonResponse(payload: any) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(payload),
    } as Response);
  }

  it('discovers Ollama models from /api/tags', async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({
        models: [{ name: 'llama3.2:latest' }, { name: 'nomic-embed-text' }],
      }),
    );

    const models = await service.discoverModels({
      id: 'provider-id',
      name: 'Local Ollama',
      type: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      apiKeyEnvVar: null,
      encryptedApiKey: null,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/tags',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(models).toEqual([
      { modelId: 'llama3.2:latest', name: 'llama3.2:latest' },
      { modelId: 'nomic-embed-text', name: 'nomic-embed-text' },
    ]);
  });

  it('discovers OpenAI-style models from /models', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    fetchMock.mockReturnValueOnce(
      jsonResponse({
        data: [{ id: 'gpt-4.1-mini' }, { id: 'text-embedding-3-small' }],
      }),
    );

    const models = await service.discoverModels({
      id: 'provider-id',
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnvVar: null,
      encryptedApiKey: 'encrypted:test-key',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: 'Bearer test-key',
        }),
      }),
    );
    expect(models).toEqual([
      { modelId: 'gpt-4.1-mini', name: 'gpt-4.1-mini' },
      { modelId: 'text-embedding-3-small', name: 'text-embedding-3-small' },
    ]);
  });

  it('requires an API key env var for OpenAI discovery', async () => {
    await expect(
      service.discoverModels({
        id: 'provider-id',
        name: 'OpenAI',
        type: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnvVar: null,
        encryptedApiKey: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
