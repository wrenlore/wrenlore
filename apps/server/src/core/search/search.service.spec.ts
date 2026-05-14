import { SearchService } from './search.service';

describe('SearchService', () => {
  const createQueryBuilder = () => {
    const qb: any = {
      select: jest.fn(() => qb),
      where: jest.fn(() => qb),
      $if: jest.fn((condition: boolean, callback: (builder: any) => any) =>
        condition ? callback(qb) : qb,
      ),
      orderBy: jest.fn(() => qb),
      limit: jest.fn(() => qb),
      offset: jest.fn(() => qb),
      execute: jest.fn().mockResolvedValue([]),
    };
    return qb;
  };

  it('scopes authenticated explicit-space page search to the caller workspace and space memberships before retrieval', async () => {
    const queryBuilder = createQueryBuilder();
    const db = {
      selectFrom: jest.fn().mockReturnValue(queryBuilder),
    };
    const userSpaceIdsQuery = { query: 'user-space-ids' };
    const spaceMemberRepo = {
      getUserSpaceIdsQuery: jest.fn().mockReturnValue(userSpaceIdsQuery),
    };
    const pagePermissionRepo = {
      filterAccessiblePageIds: jest.fn(),
    };
    const service = new SearchService(
      db as any,
      { withSpace: jest.fn().mockReturnValue('space') } as any,
      {} as any,
      spaceMemberRepo as any,
      pagePermissionRepo as any,
    );

    await service.searchPage(
      { query: 'roadmap', spaceId: 'requested-space-id' },
      { userId: 'user-id', workspaceId: 'workspace-id' },
    );

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'spaceId',
      '=',
      'requested-space-id',
    );
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'workspaceId',
      '=',
      'workspace-id',
    );
    expect(spaceMemberRepo.getUserSpaceIdsQuery).toHaveBeenCalledWith('user-id');
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'spaceId',
      'in',
      userSpaceIdsQuery,
    );
    expect(queryBuilder.where).toHaveBeenCalledWith(expect.anything());
    expect(queryBuilder.execute).toHaveBeenCalledTimes(1);
    expect(pagePermissionRepo.filterAccessiblePageIds).not.toHaveBeenCalled();
  });
});
