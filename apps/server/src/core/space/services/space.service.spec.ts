import { Test, TestingModule } from '@nestjs/testing';
import { SpaceRepo } from '@wrenlore/db/repos/space/space.repo';
import { AUDIT_SERVICE } from '../../../integrations/audit/audit.service';
import { SpaceMemberService } from './space-member.service';
import { SpaceService } from './space.service';

describe('SpaceService', () => {
  let service: SpaceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceService,
        { provide: SpaceRepo, useValue: {} },
        { provide: SpaceMemberService, useValue: {} },
        { provide: 'KyselyModuleConnectionToken', useValue: {} },
        { provide: 'BullQueue_{attachment-queue}', useValue: {} },
        { provide: AUDIT_SERVICE, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get<SpaceService>(SpaceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
