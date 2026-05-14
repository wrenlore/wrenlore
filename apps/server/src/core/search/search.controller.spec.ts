import { ForbiddenException } from '@nestjs/common';
import { SearchController } from './search.controller';

describe('SearchController', () => {
  const workspace = { id: 'workspace-id' } as any;
  const user = { id: 'user-id' } as any;

  const createController = (spaceCannotRead: boolean) => {
    const searchService = {
      searchPage: jest.fn().mockResolvedValue({ items: [] }),
      searchSuggestions: jest.fn(),
    };
    const spaceAbility = {
      createForUser: jest.fn().mockResolvedValue({
        cannot: jest.fn().mockReturnValue(spaceCannotRead),
      }),
    };

    const controller = new SearchController(
      searchService as any,
      spaceAbility as any,
    );

    return { controller, searchService, spaceAbility };
  };

  it('rejects normal Search for an explicit spaceId the user cannot read before retrieval', async () => {
    const { controller, searchService, spaceAbility } = createController(true);

    await expect(
      controller.pageSearch(
        { query: 'restricted roadmap', spaceId: 'unauthorized-space-id' },
        user,
        workspace,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(spaceAbility.createForUser).toHaveBeenCalledWith(
      user,
      'unauthorized-space-id',
    );
    expect(searchService.searchPage).not.toHaveBeenCalled();
  });

  it('allows normal Search for an explicit spaceId the user can read', async () => {
    const { controller, searchService, spaceAbility } = createController(false);

    await expect(
      controller.pageSearch(
        { query: 'allowed roadmap', spaceId: 'authorized-space-id' },
        user,
        workspace,
      ),
    ).resolves.toEqual({ items: [] });

    expect(spaceAbility.createForUser).toHaveBeenCalledWith(
      user,
      'authorized-space-id',
    );
    expect(searchService.searchPage).toHaveBeenCalledWith(
      { query: 'allowed roadmap', spaceId: 'authorized-space-id' },
      { userId: user.id, workspaceId: workspace.id },
    );
  });

  it('strips shareId from authenticated normal Search requests', async () => {
    const { controller, searchService } = createController(false);

    await controller.pageSearch(
      { query: 'workspace policy', shareId: 'share-id' } as any,
      user,
      workspace,
    );

    expect(searchService.searchPage).toHaveBeenCalledWith(
      { query: 'workspace policy' },
      { userId: user.id, workspaceId: workspace.id },
    );
  });
});
