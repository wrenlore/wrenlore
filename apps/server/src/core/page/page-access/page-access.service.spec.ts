import { ForbiddenException } from '@nestjs/common';
import { PageAccessService } from './page-access.service';

describe('PageAccessService', () => {
  const page = { id: 'page-id', spaceId: 'space-id' } as any;
  const user = { id: 'user-id' } as any;

  const createService = (opts: { canAccess: boolean; canEdit: boolean }) => {
    const pagePermissionRepo = {
      canUserAccessPage: jest.fn().mockResolvedValue(opts.canAccess),
      canUserEditPage: jest.fn().mockResolvedValue({
        hasAnyRestriction: true,
        canAccess: opts.canAccess,
        canEdit: opts.canEdit,
      }),
    };
    const ability = {
      can: jest.fn().mockReturnValue(true),
      cannot: jest.fn().mockReturnValue(false),
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
    expect(pagePermissionRepo.canUserAccessPage).toHaveBeenCalledWith(
      user.id,
      page.id,
    );
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
});
