import { Test, TestingModule } from '@nestjs/testing';
import { CommentRepo } from '@wrenlore/db/repos/comment/comment.repo';
import { PageRepo } from '@wrenlore/db/repos/page/page.repo';
import { WsService } from '../../ws/ws.service';
import { CommentService } from './comment.service';

describe('CommentService', () => {
  let service: CommentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentService,
        { provide: CommentRepo, useValue: {} },
        { provide: PageRepo, useValue: {} },
        { provide: WsService, useValue: {} },
        { provide: 'BullQueue_{general-queue}', useValue: {} },
        { provide: 'BullQueue_{notification-queue}', useValue: {} },
      ],
    }).compile();

    service = module.get<CommentService>(CommentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
