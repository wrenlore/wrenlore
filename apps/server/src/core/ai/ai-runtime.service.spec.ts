import { AiRuntimeService } from './ai-runtime.service';
import { AiUrlSourceService } from './ai-url-source.service';

function createUrlSourceStub(): AiUrlSourceService {
  return {
    extractUrls: jest.fn().mockReturnValue([]),
    retrieve: jest.fn().mockResolvedValue([]),
    applyToRequest: jest.fn((dto: any) => dto),
    summarizeSources: jest.fn().mockReturnValue([]),
  } as unknown as AiUrlSourceService;
}

describe('AiRuntimeService', () => {
  it('does not use retrieval for plain Ask AI text generation', async () => {
    const route = {
      resolvedTaskClass: 'text-generation',
      provider: { id: 'provider-id', name: 'Provider', type: 'openai' },
      model: { id: 'model-id', name: 'Model', modelId: 'model-name' },
    };
    const taskRouter = {
      resolveRoute: jest.fn().mockResolvedValue(route),
    };
    const providerGateway = {
      generateText: jest.fn().mockResolvedValue({
        content: 'Generated response',
        usage: { inputTokens: 1, outputTokens: 2 },
      }),
    };
    const searchService = {
      searchPage: jest.fn(),
    };

    const service = new AiRuntimeService(
      {} as any,
      taskRouter as any,
      providerGateway as any,
      searchService as any,
      createUrlSourceStub(),
    );

    await expect(
      service.generate('workspace-id', { prompt: 'Improve this sentence.' }),
    ).resolves.toMatchObject({
      content: 'Generated response',
      taskClass: 'text-generation',
    });

    expect(taskRouter.resolveRoute).toHaveBeenCalledWith(
      'workspace-id',
      'text-generation',
    );
    expect(providerGateway.generateText).toHaveBeenCalledWith(route, {
      prompt: 'Improve this sentence.',
    });
    expect(searchService.searchPage).not.toHaveBeenCalled();
  });

  it('builds AI Answers context only from permission-scoped search results', async () => {
    const route = {
      resolvedTaskClass: 'grounded-answer-generation',
      provider: { id: 'provider-id', name: 'Provider', type: 'openai' },
      model: { id: 'model-id', name: 'Model', modelId: 'model-name' },
    };
    const taskRouter = {
      resolveRoute: jest.fn().mockResolvedValue(route),
    };
    const providerGateway = {
      generateText: jest.fn().mockResolvedValue({
        content: 'Allowed answer [S1]',
      }),
    };
    const searchService = {
      searchPage: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'allowed-page-id',
            slugId: 'allowed-page-slug',
            title: 'Allowed page',
            rank: 1,
            space: {
              id: 'space-id',
              slug: 'space',
              name: 'Space',
            },
          },
        ],
      }),
    };
    const pageTextQuery = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue([
        {
          id: 'allowed-page-id',
          textContent: 'Allowed restricted content for this user.',
        },
      ]),
    };
    const db = {
      selectFrom: jest.fn().mockReturnValue(pageTextQuery),
    };

    const service = new AiRuntimeService(
      db as any,
      taskRouter as any,
      providerGateway as any,
      searchService as any,
      createUrlSourceStub(),
    );

    await expect(
      service.groundedAnswer('workspace-id', 'user-id', {
        query: 'allowed restricted content',
        spaceId: 'space-id',
      }),
    ).resolves.toMatchObject({
      status: 'ok',
      citations: [{ pageId: 'allowed-page-id' }],
    });

    expect(searchService.searchPage).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'allowed restricted content',
        spaceId: 'space-id',
      }),
      { userId: 'user-id', workspaceId: 'workspace-id' },
    );
    expect(pageTextQuery.where).toHaveBeenCalledWith('id', 'in', [
      'allowed-page-id',
    ]);
    expect(providerGateway.generateText).toHaveBeenCalledWith(
      route,
      expect.objectContaining({
        prompt: expect.stringContaining(
          'Allowed restricted content for this user.',
        ),
      }),
    );
  });

  describe('read-this-URL retrieval', () => {
    const route = {
      resolvedTaskClass: 'streaming-generation',
      provider: { id: 'provider-id', name: 'Provider', type: 'openai' },
      model: { id: 'model-id', name: 'Model', modelId: 'model-name' },
    };

    const createService = (urlSource: Partial<AiUrlSourceService>) => {
      const taskRouter = {
        resolveRoute: jest.fn().mockResolvedValue(route),
      };
      const providerGateway = {
        generateText: jest.fn().mockResolvedValue({ content: 'answer' }),
        streamText: jest.fn().mockImplementation(async function* () {
          yield 'chunk-1';
          yield 'chunk-2';
        }),
      };
      const stub = {
        extractUrls: jest.fn().mockReturnValue([]),
        retrieve: jest.fn().mockResolvedValue([]),
        applyToRequest: jest.fn((dto: any) => dto),
        summarizeSources: jest.fn().mockReturnValue([]),
        ...urlSource,
      } as unknown as AiUrlSourceService;

      const service = new AiRuntimeService(
        {} as any,
        taskRouter as any,
        providerGateway as any,
        { searchPage: jest.fn() } as any,
        stub,
      );

      return { service, taskRouter, providerGateway, stub };
    };

    it('does not retrieve anything when the instruction has no URLs', async () => {
      const { service, providerGateway, stub } = createService({});

      const result = await service.generate('workspace-id', {
        prompt: 'Summarize the selected text.',
        instruction: 'Summarize the selected text.',
      });

      expect(stub.retrieve).toHaveBeenCalledWith([]);
      expect(providerGateway.generateText).toHaveBeenCalledWith(
        route,
        expect.objectContaining({ prompt: 'Summarize the selected text.' }),
      );
      expect(result).not.toHaveProperty('sources');
    });

    it('does not retrieve anything when no instruction is supplied', async () => {
      const { service, stub } = createService({});

      await service.generate('workspace-id', {
        prompt: 'Improve https://example.com/incidental-link in the text.',
      });

      expect(stub.extractUrls).toHaveBeenCalledWith(undefined);
      expect(stub.retrieve).toHaveBeenCalledWith([]);
    });

    it('attaches retrieved sources to non-streaming generation', async () => {
      const source = {
        url: 'https://github.com/wrenlore/wrenlore',
        status: 'ok' as const,
        text: 'Repo facts.',
      };
      const { service, providerGateway, stub } = createService({
        extractUrls: jest
          .fn()
          .mockReturnValue(['https://github.com/wrenlore/wrenlore']),
        retrieve: jest.fn().mockResolvedValue([source]),
        applyToRequest: jest.fn((dto: any) => ({
          ...dto,
          prompt: `${dto.prompt}\n\nCTX: ${source.text}`,
        })),
        summarizeSources: jest
          .fn()
          .mockReturnValue([{ url: source.url, status: 'ok' }]),
      });

      const result = await service.generate('workspace-id', {
        prompt: 'What does this repo do? https://github.com/wrenlore/wrenlore',
        instruction:
          'What does this repo do? https://github.com/wrenlore/wrenlore',
      });

      expect(providerGateway.generateText).toHaveBeenCalledWith(
        route,
        expect.objectContaining({
          prompt: expect.stringContaining('CTX: Repo facts.'),
        }),
      );
      expect(result).toMatchObject({
        content: 'answer',
        sources: [
          { url: 'https://github.com/wrenlore/wrenlore', status: 'ok' },
        ],
      });
    });

    it('emits source status events before content when streaming', async () => {
      const source = {
        url: 'https://example.com/page',
        status: 'ok' as const,
        text: 'Page facts.',
      };
      const { service, providerGateway, stub } = createService({
        extractUrls: jest.fn().mockReturnValue(['https://example.com/page']),
        retrieve: jest.fn().mockResolvedValue([source]),
        applyToRequest: jest.fn((dto: any) => ({
          ...dto,
          prompt: `${dto.prompt}\n\nCTX`,
        })),
      });

      const events: any[] = [];
      for await (const event of service.streamGenerate(
        'workspace-id',
        {
          prompt: 'read https://example.com/page',
          instruction: 'read https://example.com/page',
        },
        undefined,
      )) {
        events.push(event);
      }

      expect(events).toEqual([
        { status: 'fetching_source', url: 'https://example.com/page' },
        { status: 'source_fetched', url: 'https://example.com/page' },
        { content: 'chunk-1' },
        { content: 'chunk-2' },
      ]);
      expect(providerGateway.streamText).toHaveBeenCalledWith(
        route,
        expect.objectContaining({ prompt: expect.stringContaining('CTX') }),
        undefined,
      );
      expect(stub.retrieve).toHaveBeenCalledWith(
        ['https://example.com/page'],
        undefined,
      );
    });

    it('propagates the abort signal into retrieval', async () => {
      const controller = new AbortController();
      const { service, stub } = createService({
        extractUrls: jest.fn().mockReturnValue(['https://example.com/page']),
        retrieve: jest.fn().mockRejectedValue(new Error('Aborted')),
      });

      const iterator = service.streamGenerate(
        'workspace-id',
        {
          prompt: 'read https://example.com/page',
          instruction: 'read https://example.com/page',
        },
        controller.signal,
      );

      const first = await iterator.next();
      expect(first.value).toMatchObject({ status: 'fetching_source' });
      await expect(iterator.next()).rejects.toThrow('Aborted');
      expect(stub.retrieve).toHaveBeenCalledWith(
        ['https://example.com/page'],
        controller.signal,
      );
    });

    it('yields only content events when the instruction has no URLs', async () => {
      const { service } = createService({});

      const events: any[] = [];
      for await (const event of service.streamGenerate(
        'workspace-id',
        { prompt: 'Improve this.', instruction: 'Improve this.' },
        undefined,
      )) {
        events.push(event);
      }

      expect(events).toEqual([{ content: 'chunk-1' }, { content: 'chunk-2' }]);
    });
  });
});
