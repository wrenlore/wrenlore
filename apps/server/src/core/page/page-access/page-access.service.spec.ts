import { ForbiddenException } from '@nestjs/common';
import { PageAccessService } from './page-access.service';

describe('PageAccessService', () => {
  const page = { id: 'page-id', spaceId: 'space-id' } as any;
  const user = { id: 'user-id' } as any;

  const createService = (opts: {
    hasAnyRestriction?: boolean;
    canAccess: boolean;
    canEdit: boolean;
    spaceCanRead?: boolean;
    spaceCanEdit?: boolean;
  }) => {
    const pagePermissionRepo = {
      canUserEditPage: jest.fn().mockResolvedValue({
        hasAnyRestriction: opts.hasAnyRestriction ?? true,
        canAccess: opts.canAccess,
        canEdit: opts.canEdit,
      }),
    };
    const ability = {
      can: jest.fn((action) =>
        action === 'edit'
          ? (opts.spaceCanEdit ?? true)
          : (opts.spaceCanRead ?? true),
      ),
      cannot: jest.fn((action) =>
        action === 'edit'
          ? !(opts.spaceCanEdit ?? true)
          : !(opts.spaceCanRead ?? true),
      ),
    };
    const spaceAbility = {
      createForUser: jest.fn().mockResolvedValue(ability),
    };

    const service = new PageAccessService(
      pagePermissionRepo as any,
      spaceAbility as any,
    );

    return { service, pagePermissionRepo };
  };

  it('allows authorised users to read restricted pages', async () => {
    const { service, pagePermissionRepo } = createService({
      canAccess: true,
      canEdit: false,
    });

    await expect(service.validateCanView(page, user)).resolves.toBeUndefined();
    expect(pagePermissionRepo.canUserEditPage).toHaveBeenCalledWith(
      user.id,
      page.id,
    );
  });

  it('allows explicit restricted-page readers without space read access to open the page', async () => {
    const { service } = createService({
      canAccess: true,
      canEdit: false,
      spaceCanRead: false,
      spaceCanEdit: false,
    });

    await expect(service.validateCanView(page, user)).resolves.toBeUndefined();
    await expect(
      service.validateCanViewWithPermissions(page, user),
    ).resolves.toEqual({
      canEdit: false,
      hasRestriction: true,
    });
  });

  it('blocks unauthorised users from reading restricted pages', async () => {
    const { service } = createService({ canAccess: false, canEdit: false });

    await expect(service.validateCanView(page, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('blocks restricted-page readers from editing', async () => {
    const { service } = createService({ canAccess: true, canEdit: false });

    await expect(service.validateCanEdit(page, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows restricted-page writers to edit', async () => {
    const { service } = createService({ canAccess: true, canEdit: true });

    await expect(service.validateCanEdit(page, user)).resolves.toEqual({
      hasRestriction: true,
    });
  });

  it('allows explicit restricted-page writers without space edit access to edit', async () => {
    const { service } = createService({
      canAccess: true,
      canEdit: true,
      spaceCanRead: false,
      spaceCanEdit: false,
    });

    await expect(service.validateCanEdit(page, user)).resolves.toEqual({
      hasRestriction: true,
    });
  });

  it('still requires space read access for unrestricted pages', async () => {
    const { service } = createService({
      hasAnyRestriction: false,
      canAccess: true,
      canEdit: true,
      spaceCanRead: false,
    });

    await expect(service.validateCanView(page, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
