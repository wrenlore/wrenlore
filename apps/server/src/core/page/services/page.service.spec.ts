jest.mock('@wrenlore/editor-ext', () => ({
  markdownToHtml: jest.fn(),
}));

jest.mock('../../../common/helpers/prosemirror/utils', () => ({
  createYdocFromJson: jest.fn(),
  getAttachmentIds: jest.fn(() => []),
  getProsemirrorContent: jest.fn((content) => content),
  isAttachmentNode: jest.fn(() => false),
  removeMarkTypeFromDoc: jest.fn((doc) => doc),
}));

jest.mock('src/collaboration/collaboration.util', () => ({
  htmlToJson: jest.fn(),
  jsonToNode: jest.fn(),
  jsonToText: jest.fn(() => ''),
}), { virtual: true });

jest.mock('../../../collaboration/collaboration.gateway', () => ({
  CollaborationGateway: class CollaborationGateway {},
}));

import { PageService } from './page.service';

describe('PageService page permissions', () => {
  const page = {
    id: 'page-id',
    workspaceId: 'workspace-id',
    spaceId: 'space-id',
  } as any;
  const authUser = { id: 'author-id' } as any;

  const createService = () => {
    const trx = {
      deleteFrom: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      }),
    };
    const db = {
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn((callback) => callback(trx)),
      }),
    };
    const pagePermissionRepo = {
      findPageAccessByPageId: jest.fn(),
      insertPageAccess: jest.fn().mockResolvedValue({ id: 'page-access-id' }),
      insertPagePermissions: jest.fn().mockResolvedValue(undefined),
      deletePageAccess: jest.fn().mockResolvedValue(undefined),
      getUserPageAccessLevel: jest.fn().mockResolvedValue({
        hasInheritedRestriction: false,
        canAccess: true,
        canEdit: true,
      }),
      getPagePermissionsPaginated: jest.fn().mockResolvedValue({
        items: [{ id: 'author-id', type: 'user', role: 'writer' }],
      }),
    };

    const service = new PageService(
      {} as any,
      pagePermissionRepo as any,
      {} as any,
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, pagePermissionRepo, trx };
  };

  it('creates a restricted page access list and keeps the acting user as writer', async () => {
    const { service, pagePermissionRepo } = createService();
    pagePermissionRepo.findPageAccessByPageId.mockResolvedValue(undefined);

    await service.setPagePermissions(page, authUser, [
      { id: 'reader-id', type: 'user', role: 'reader' },
    ]);

    expect(pagePermissionRepo.insertPageAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: page.id,
        workspaceId: page.workspaceId,
        spaceId: page.spaceId,
        accessLevel: 'restricted',
        creatorId: authUser.id,
      }),
      expect.anything(),
    );
    expect(pagePermissionRepo.insertPagePermissions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          pageAccessId: 'page-access-id',
          userId: 'reader-id',
          role: 'reader',
        }),
        expect.objectContaining({
          pageAccessId: 'page-access-id',
          userId: authUser.id,
          role: 'writer',
        }),
      ]),
      expect.anything(),
    );
  });

  it('clears the direct page restriction', async () => {
    const { service, pagePermissionRepo } = createService();

    await service.clearPagePermissions(page, authUser.id);

    expect(pagePermissionRepo.deletePageAccess).toHaveBeenCalledWith(page.id);
  });
});
