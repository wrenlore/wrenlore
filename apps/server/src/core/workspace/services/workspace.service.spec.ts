import { Test, TestingModule } from '@nestjs/testing';
import { GroupRepo } from '@wrenlore/db/repos/group/group.repo';
import { GroupUserRepo } from '@wrenlore/db/repos/group/group-user.repo';
import { InstanceSettingRepo } from '@wrenlore/db/repos/instance-setting/instance-setting.repo';
import { UserRepo } from '@wrenlore/db/repos/user/user.repo';
import { UserMfaRepo } from '@wrenlore/db/repos/user/user-mfa.repo';
import { WatcherRepo } from '@wrenlore/db/repos/watcher/watcher.repo';
import { WorkspaceRepo } from '@wrenlore/db/repos/workspace/workspace.repo';
import { AUDIT_SERVICE } from '../../../integrations/audit/audit.service';
import { DomainService } from '../../../integrations/environment/domain.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { SpaceMemberService } from '../../space/services/space-member.service';
import { SpaceService } from '../../space/services/space.service';
import { WorkspaceService } from './workspace.service';

describe('WorkspaceService', () => {
  let service: WorkspaceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        { provide: WorkspaceRepo, useValue: {} },
        { provide: SpaceService, useValue: {} },
        { provide: SpaceMemberService, useValue: {} },
        { provide: GroupRepo, useValue: {} },
        { provide: GroupUserRepo, useValue: {} },
        { provide: UserRepo, useValue: {} },
        { provide: EnvironmentService, useValue: {} },
        { provide: DomainService, useValue: {} },
        { provide: WatcherRepo, useValue: {} },
        { provide: UserMfaRepo, useValue: {} },
        { provide: InstanceSettingRepo, useValue: {} },
        { provide: 'KyselyModuleConnectionToken', useValue: {} },
        { provide: 'BullQueue_{attachment-queue}', useValue: {} },
        { provide: 'BullQueue_{billing-queue}', useValue: {} },
        { provide: 'BullQueue_{ai-queue}', useValue: {} },
        { provide: AUDIT_SERVICE, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
