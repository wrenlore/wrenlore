import { Test, TestingModule } from '@nestjs/testing';
import { AUDIT_SERVICE } from '../../../integrations/audit/audit.service';
import { GroupRepo } from '@wrenlore/db/repos/group/group.repo';
import { GroupUserRepo } from '@wrenlore/db/repos/group/group-user.repo';
import { SpaceMemberRepo } from '@wrenlore/db/repos/space/space-member.repo';
import { WatcherRepo } from '@wrenlore/db/repos/watcher/watcher.repo';
import { GroupUserService } from './group-user.service';
import { GroupService } from './group.service';

describe('GroupService', () => {
  let service: GroupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupService,
        { provide: GroupRepo, useValue: {} },
        { provide: GroupUserRepo, useValue: {} },
        { provide: SpaceMemberRepo, useValue: {} },
        { provide: GroupUserService, useValue: {} },
        { provide: WatcherRepo, useValue: {} },
        { provide: 'KyselyModuleConnectionToken', useValue: {} },
        { provide: AUDIT_SERVICE, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get<GroupService>(GroupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
