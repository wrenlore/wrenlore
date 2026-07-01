import { Test, TestingModule } from '@nestjs/testing';
import { SpaceMemberRepo } from '@wrenlore/db/repos/space/space-member.repo';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import { SpaceController } from './space.controller';
import { SpaceMemberService } from './services/space-member.service';
import { SpaceService } from './services/space.service';

describe('SpaceController', () => {
  let controller: SpaceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SpaceController],
      providers: [
        { provide: SpaceService, useValue: {} },
        { provide: SpaceMemberService, useValue: {} },
        { provide: SpaceMemberRepo, useValue: {} },
        { provide: SpaceAbilityFactory, useValue: {} },
        { provide: WorkspaceAbilityFactory, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<SpaceController>(SpaceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
