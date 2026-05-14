import { ForbiddenException } from '@nestjs/common';
import { AiController } from './ai.controller';

describe('AiController', () => {
  const workspace = { id: 'workspace-id' } as any;
  const user = { id: 'user-id' } as any;

  const createController = (spaceCannotRead: boolean) => {
    const runtimeService = {
      groundedAnswer: jest.fn().mockResolvedValue({
        status: 'ok',
        answer: 'Allowed answer',
        citations: [],
      }),
    };
    const adminService = {};
    const workspaceAbility = {
      createForUser: jest.fn().mockReturnValue({ cannot: jest.fn() }),
    };
    const spaceAbility = {
      createForUser: jest.fn().mockResolvedValue({
        cannot: jest.fn().mockReturnValue(spaceCannotRead),
      }),
    };

    const controller = new AiController(
      runtimeService as any,
      adminService as any,
      workspaceAbility as any,
      spaceAbility as any,
    );

    return { controller, runtimeService, spaceAbility };
  };

  it('rejects AI Answers for an explicit spaceId the user cannot read before retrieval', async () => {
    const { controller, runtimeService, spaceAbility } = createController(true);

    await expect(
      controller.groundedAnswer(
        { query: 'restricted roadmap', spaceId: 'unauthorized-space-id' },
        workspace,
        user,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(spaceAbility.createForUser).toHaveBeenCalledWith(
      user,
      'unauthorized-space-id',
    );
    expect(runtimeService.groundedAnswer).not.toHaveBeenCalled();
  });

  it('allows AI Answers for an explicit spaceId the user can read', async () => {
    const { controller, runtimeService, spaceAbility } = createController(false);

    await expect(
      controller.groundedAnswer(
        { query: 'allowed roadmap', spaceId: 'authorized-space-id' },
        workspace,
        user,
      ),
    ).resolves.toMatchObject({ status: 'ok' });

    expect(spaceAbility.createForUser).toHaveBeenCalledWith(
      user,
      'authorized-space-id',
    );
    expect(runtimeService.groundedAnswer).toHaveBeenCalledWith(
      workspace.id,
      user.id,
      { query: 'allowed roadmap', spaceId: 'authorized-space-id' },
    );
  });

  it('keeps unscoped AI Answers on the permission-scoped search runtime path', async () => {
    const { controller, runtimeService, spaceAbility } = createController(false);

    await controller.groundedAnswer({ query: 'workspace policy' }, workspace, user);

    expect(spaceAbility.createForUser).not.toHaveBeenCalled();
    expect(runtimeService.groundedAnswer).toHaveBeenCalledWith(
      workspace.id,
      user.id,
      { query: 'workspace policy' },
    );
  });
});
