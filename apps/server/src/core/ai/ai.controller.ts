import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User, Workspace } from '@wrenlore/db/types/entity.types';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { AiRuntimeService } from './ai-runtime.service';
import { AiAdminService } from './ai-admin.service';
import {
  GenerateAiTextDto,
  GenerateEmbeddingsDto,
  GroundedAnswerDto,
} from './dto/ai-generation.dto';
import {
  CreateAiModelDto,
  CreateAiProviderDto,
  DeleteAiModelDto,
  DeleteAiProviderDto,
  DiscoverAiModelsDto,
  ListAiModelsDto,
  ProviderHealthCheckDto,
  UpdateAiModelDto,
  UpdateAiProviderDto,
  UpsertAiTaskRoutesDto,
} from './dto/ai-admin.dto';

@UseGuards(JwtAuthGuard)
@Controller('wren-ai')
export class AiController {
  constructor(
    private readonly runtimeService: AiRuntimeService,
    private readonly adminService: AiAdminService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('generate')
  async generate(
    @Body() dto: GenerateAiTextDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.runtimeService.generate(workspace.id, dto);
  }

  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @Post('generate/stream')
  async streamGenerate(
    @Body() dto: GenerateAiTextDto,
    @AuthWorkspace() workspace: Workspace,
    @Res() res: FastifyReply,
  ) {
    res.hijack();
    res.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    res.raw.setHeader('Connection', 'keep-alive');
    res.raw.setHeader('X-Accel-Buffering', 'no');

    const abortController = new AbortController();
    const onClose = () => abortController.abort();
    res.raw.on('close', onClose);

    try {
      for await (const chunk of this.runtimeService.streamGenerate(
        workspace.id,
        dto,
        abortController.signal,
      )) {
        if (!res.raw.writableEnded) {
          res.raw.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
      }

      if (!res.raw.writableEnded) {
        res.raw.write('data: [DONE]\n\n');
      }
    } catch (err) {
      if (!res.raw.writableEnded) {
        const errorMessage =
          err instanceof Error ? err.message : 'Unknown streaming error';
        res.raw.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
        res.raw.write('data: [DONE]\n\n');
      }
    } finally {
      res.raw.off('close', onClose);
      if (!res.raw.writableEnded) {
        res.raw.end();
      }
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('grounded-answer')
  async groundedAnswer(
    @Body() dto: GroundedAnswerDto,
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    if (dto.spaceId) {
      await this.assertCanReadSpace(user, dto.spaceId);
    }

    return this.runtimeService.groundedAnswer(workspace.id, user.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('embeddings/generate')
  async generateEmbeddings(
    @Body() dto: GenerateEmbeddingsDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.runtimeService.generateEmbeddings(workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/providers/list')
  async listProviders(
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    this.assertCanManageAiSettings(user, workspace);
    return this.adminService.listProviders(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/providers/create')
  async createProvider(
    @Body() dto: CreateAiProviderDto,
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    this.assertCanManageAiSettings(user, workspace);
    return this.adminService.createProvider(workspace.id, user.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/providers/update')
  async updateProvider(
    @Body() dto: UpdateAiProviderDto,
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    this.assertCanManageAiSettings(user, workspace);
    return this.adminService.updateProvider(workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/providers/delete')
  async deleteProvider(
    @Body() dto: DeleteAiProviderDto,
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    this.assertCanManageAiSettings(user, workspace);
    await this.adminService.deleteProvider(workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/models/list')
  async listModels(
    @Body() dto: ListAiModelsDto,
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    this.assertCanManageAiSettings(user, workspace);
    return this.adminService.listModels(workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/models/discover')
  async discoverModels(
    @Body() dto: DiscoverAiModelsDto,
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    this.assertCanManageAiSettings(user, workspace);
    return this.adminService.discoverModels(workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/models/create')
  async createModel(
    @Body() dto: CreateAiModelDto,
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    this.assertCanManageAiSettings(user, workspace);
    return this.adminService.createModel(workspace.id, user.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/models/update')
  async updateModel(
    @Body() dto: UpdateAiModelDto,
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    this.assertCanManageAiSettings(user, workspace);
    return this.adminService.updateModel(workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/models/delete')
  async deleteModel(
    @Body() dto: DeleteAiModelDto,
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    this.assertCanManageAiSettings(user, workspace);
    await this.adminService.deleteModel(workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/task-routes/list')
  async listTaskRoutes(
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    this.assertCanManageAiSettings(user, workspace);
    return this.adminService.listTaskRoutes(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/task-routes/upsert')
  async upsertTaskRoutes(
    @Body() dto: UpsertAiTaskRoutesDto,
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    this.assertCanManageAiSettings(user, workspace);
    return this.adminService.upsertTaskRoutes(workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('admin/providers/health')
  async providerHealth(
    @Body() dto: ProviderHealthCheckDto,
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    this.assertCanManageAiSettings(user, workspace);
    return this.adminService.providerHealth(workspace.id, dto);
  }

  private assertCanManageAiSettings(user: User, workspace: Workspace) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)
    ) {
      throw new ForbiddenException();
    }
  }

  private async assertCanReadSpace(user: User, spaceId: string) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }
}
