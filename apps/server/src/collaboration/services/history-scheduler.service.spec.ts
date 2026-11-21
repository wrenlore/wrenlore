import { HistoryScheduler } from './history-scheduler.service';

describe('HistoryScheduler', () => {
  it('does not overlap drain batches and waits for in-flight work on shutdown', async () => {
    let release: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const histories = {
      findDueHistory: jest.fn().mockResolvedValue([{ pageId: 'page' }]),
      savePendingHistory: jest.fn().mockImplementation(async () => {
        await pending;
        return null;
      }),
    };
    const scheduler = new HistoryScheduler(histories as any, {} as any);
    const first = scheduler.drain();
    expect(scheduler.drain()).toBe(first);
    let stopped = false;
    const shutdown = scheduler.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await Promise.all([first, shutdown]);
    expect(histories.findDueHistory).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(true);
  });

  it('retains failed work and continues saving other pages in the same batch', async () => {
    const histories = {
      findDueHistory: jest
        .fn()
        .mockResolvedValue([{ pageId: 'bad' }, { pageId: 'good' }]),
      savePendingHistory: jest
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error('Failure'), { code: 'TEST' }),
        )
        .mockResolvedValueOnce({
          spaceId: 'space',
          workspaceId: 'workspace',
          contributorIds: ['user'],
        }),
      deferHistoryRetry: jest.fn().mockResolvedValue(undefined),
    };
    const watchers = {
      addPageWatchers: jest
        .fn()
        .mockRejectedValue(new Error('Watcher failure')),
    };
    await new HistoryScheduler(histories as any, watchers as any).drain();
    expect(histories.deferHistoryRetry).toHaveBeenCalledWith('bad', 'TEST');
    expect(histories.savePendingHistory).toHaveBeenCalledWith('good');
    expect(watchers.addPageWatchers).toHaveBeenCalledWith(
      ['user'],
      'good',
      'space',
      'workspace',
    );
    expect(histories.deferHistoryRetry).toHaveBeenCalledTimes(1);
  });
});
