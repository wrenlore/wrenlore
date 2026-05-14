import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateSpaceDto } from '../dto/create-space.dto';
import { PaginationOptions } from '@wrenlore/db/pagination/pagination-options';
import { SpaceRepo } from '@wrenlore/db/repos/space/space.repo';
import { KyselyDB, KyselyTransaction } from '@wrenlore/db/types/kysely.types';
import { Space, User } from '@wrenlore/db/types/entity.types';
import { UpdateSpaceDto } from '../dto/update-space.dto';
import { executeTx } from '@wrenlore/db/utils';
import { InjectKysely } from 'nestjs-kysely';
import { SpaceMemberService } from './space-member.service';
import { SpaceRole } from '../../../common/helpers/types/permission';
import { QueueJob, QueueName } from 'src/integrations/queue/constants';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { CursorPaginationResult } from '@wrenlore/db/pagination/cursor-pagination';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';
import { diffAuditTrackedFields } from '../../../common/helpers';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';

@Injectable()
export class SpaceService {
  constructor(
    private spaceRepo: SpaceRepo,
    private spaceMemberService: SpaceMemberService,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE) private attachmentQueue: Queue,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async createSpace(
    authUser: User,
    workspaceId: string,
    createSpaceDto: CreateSpaceDto,
    trx?: KyselyTransaction,
  ): Promise<Space> {
    let space = null;

    await executeTx(
      this.db,
      async (trx) => {
        space = await this.create(
          authUser.id,
          workspaceId,
          createSpaceDto,
          trx,
        );

        await this.spaceMemberService.addUserToSpace(
          authUser.id,
          space.id,
          SpaceRole.ADMIN,
          workspaceId,
          trx,
        );
      },
      trx,
    );

    this.auditService.log({
      event: AuditEvent.SPACE_CREATED,
      resourceType: AuditResource.SPACE,
      resourceId: space.id,
      spaceId: space.id,
      changes: {
        after: {
          name: space.name,
          slug: space.slug,
        },
      },
    });

    return { ...space, memberCount: 1 };
  }

  async create(
    userId: string,
    workspaceId: string,
    createSpaceDto: CreateSpaceDto,
    trx?: KyselyTransaction,
  ): Promise<Space> {
    const slugExists = await this.spaceRepo.slugExists(
      createSpaceDto.slug,
      workspaceId,
      trx,
    );
    if (slugExists) {
      throw new BadRequestException(
        'Space slug exists. Please use a unique space slug',
      );
    }

    return await this.spaceRepo.insertSpace(
      {
        name: createSpaceDto.name ?? 'untitled space',
        description: createSpaceDto.description ?? '',
        creatorId: userId,
        workspaceId: workspaceId,
        slug: createSpaceDto.slug,
      },
      trx,
    );
  }

  async updateSpace(
    updateSpaceDto: UpdateSpaceDto,
    workspaceId: string,
  ): Promise<Space> {
    if (updateSpaceDto?.slug) {
      const slugExists = await this.spaceRepo.slugExists(
        updateSpaceDto.slug,
        workspaceId,
      );

      if (slugExists) {
        throw new BadRequestException(
          'Space slug exists. Please use a unique space slug',
        );
      }
    }

    const spaceBefore = await this.spaceRepo.findById(
      updateSpaceDto.spaceId,
      workspaceId,
    );
    const settingsBefore = (spaceBefore?.settings ?? {}) as Record<string, any>;

    const before: Record<string, any> = {};
    const after: Record<string, any> = {};

    let updatedSpace: Space;

    await executeTx(this.db, async (trx) => {
      if (typeof updateSpaceDto.disablePublicSharing !== 'undefined') {
        const prev = settingsBefore?.sharing?.disabled ?? false;
        if (prev !== updateSpaceDto.disablePublicSharing) {
          before.disablePublicSharing = prev;
          after.disablePublicSharing = updateSpaceDto.disablePublicSharing;
        }

        await this.spaceRepo.updateSharingSettings(
          updateSpaceDto.spaceId,
          workspaceId,
          'disabled',
          updateSpaceDto.disablePublicSharing,
          trx,
        );
      }

      updatedSpace = await this.spaceRepo.updateSpace(
        {
          name: updateSpaceDto.name,
          description: updateSpaceDto.description,
          slug: updateSpaceDto.slug,
        },
        updateSpaceDto.spaceId,
        workspaceId,
        trx,
      );
    });

    const columnChanges = diffAuditTrackedFields(
      ['name', 'slug', 'description'],
      updateSpaceDto,
      spaceBefore,
      updatedSpace,
    );
    if (columnChanges) {
      Object.assign(before, columnChanges.before);
      Object.assign(after, columnChanges.after);
    }

    if (Object.keys(after).length > 0) {
      this.auditService.log({
        event: AuditEvent.SPACE_UPDATED,
        resourceType: AuditResource.SPACE,
        resourceId: updateSpaceDto.spaceId,
        spaceId: updateSpaceDto.spaceId,
        changes: { before, after },
      });
    }

    return updatedSpace;
  }

  async getSpaceInfo(spaceId: string, workspaceId: string): Promise<Space> {
    const space = await this.spaceRepo.findById(spaceId, workspaceId, {
      includeMemberCount: true,
    });
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    return space;
  }

  async getWorkspaceSpaces(
    workspaceId: string,
    pagination: PaginationOptions,
  ): Promise<CursorPaginationResult<Space>> {
    return this.spaceRepo.getSpacesInWorkspace(workspaceId, pagination);
  }

  async deleteSpace(spaceId: string, workspaceId: string): Promise<void> {
    const space = await this.spaceRepo.findById(spaceId, workspaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    await this.spaceRepo.deleteSpace(spaceId, workspaceId);
    await this.attachmentQueue.add(QueueJob.DELETE_SPACE_ATTACHMENTS, space);

    this.auditService.log({
      event: AuditEvent.SPACE_DELETED,
      resourceType: AuditResource.SPACE,
      resourceId: spaceId,
      spaceId: spaceId,
      changes: {
        before: {
          name: space.name,
          slug: space.slug,
          description: space.description,
        },
      },
    });
  }
}
