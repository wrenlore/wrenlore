import { AiRuntimeService } from './ai-runtime.service';

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
});
