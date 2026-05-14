import { ForbiddenException } from '@nestjs/common';

jest.mock('./services/page.service', () => ({
  PageService: class PageService {},
}));

jest.mock('../../collaboration/collaboration.util', () => ({
  jsonToHtml: jest.fn(),
  jsonToMarkdown: jest.fn(),
}));

import { PageController } from './page.controller';

describe('PageController page permissions', () => {
  const page = { id: 'page-id', spaceId: 'space-id' } as any;
  const user = { id: 'user-id' } as any;

  const createController = () => {
    const pageService = {
      getPagePermissionInfo: jest.fn().mockResolvedValue({ restricted: true }),
      setPagePermissions: jest.fn().mockResolvedValue({
        restricted: true,
        members: [{ id: 'user-id', type: 'user', role: 'writer' }],
      }),
      clearPagePermissions: jest.fn().mockResolvedValue({
        restricted: false,
        members: [],
      }),
    };
    const pageRepo = {
      findById: jest.fn().mockResolvedValue(page),
    };
    const pageAccessService = {
      validateCanView: jest.fn().mockResolvedValue(undefined),
      validateCanEdit: jest.fn().mockResolvedValue(undefined),
    };
    const auditService = {
      log: jest.fn(),
    };

    const controller = new PageController(
      pageService as any,
      pageRepo as any,
      {} as any,
      {} as any,
      pageAccessService as any,
      auditService as any,
    );

    return { controller, pageService, pageRepo, pageAccessService };
  };

  it('requires page view access before returning permission info', async () => {
    const { controller, pageService, pageAccessService } = createController();

    await expect(
      controller.getPagePermissions({ pageId: page.id }, user),
    ).resolves.toMatchObject({ restricted: true });

    expect(pageAccessService.validateCanView).toHaveBeenCalledWith(page, user);
    expect(pageService.getPagePermissionInfo).toHaveBeenCalledWith(
      page,
      user.id,
    );
  });

  it('does not reveal permission info to users who cannot read the page', async () => {
    const { controller, pageService, pageAccessService } = createController();
    pageAccessService.validateCanView.mockRejectedValue(new ForbiddenException());

    await expect(
      controller.getPagePermissions({ pageId: page.id }, user),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(pageService.getPagePermissionInfo).not.toHaveBeenCalled();
  });

  it('requires page edit access before setting restrictions', async () => {
    const { controller, pageService, pageAccessService } = createController();
    const dto = {
      pageId: page.id,
      members: [{ id: 'reader-id', type: 'user' as const, role: 'reader' as const }],
    };

    await controller.setPagePermissions(dto, user);

    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(page, user);
    expect(pageService.setPagePermissions).toHaveBeenCalledWith(
      page,
      user,
      dto.members,
    );
  });

  it('does not clear restrictions when the user cannot edit the page', async () => {
    const { controller, pageService, pageAccessService } = createController();
    pageAccessService.validateCanEdit.mockRejectedValue(new ForbiddenException());

    await expect(
      controller.clearPagePermissions({ pageId: page.id }, user),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(pageService.clearPagePermissions).not.toHaveBeenCalled();
  });
});
