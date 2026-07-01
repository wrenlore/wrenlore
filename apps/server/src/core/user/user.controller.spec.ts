import { Test, TestingModule } from '@nestjs/testing';
import { InstanceSettingRepo } from '@wrenlore/db/repos/instance-setting/instance-setting.repo';
import { UserRepo } from '@wrenlore/db/repos/user/user.repo';
import { WorkspaceRepo } from '@wrenlore/db/repos/workspace/workspace.repo';
import { AUDIT_SERVICE } from '../../integrations/audit/audit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
  let controller: UserController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        UserService,
        { provide: UserRepo, useValue: {} },
        { provide: AUDIT_SERVICE, useValue: { log: jest.fn() } },
        { provide: WorkspaceRepo, useValue: {} },
        { provide: InstanceSettingRepo, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
