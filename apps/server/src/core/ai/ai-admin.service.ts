import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@wrenlore/db/types/kysely.types';
import { executeTx } from '@wrenlore/db/utils';
import {
  CreateAiModelDto,
  CreateAiProviderDto,
  DeleteAiModelDto,
  DeleteAiProviderDto,
  ListAiModelsDto,
  ProviderHealthCheckDto,
  UpdateAiModelDto,
  UpdateAiProviderDto,
  UpsertAiTaskRoutesDto,
} from './dto/ai-admin.dto';
import { AI_TASK_CLASSES } from './ai.constants';
import { AiProviderGatewayService } from './ai-provider-gateway.service';

@Injectable()
export class AiAdminService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly providerGateway: AiProviderGatewayService,
  ) {}

  async listProviders(workspaceId: string) {
    return this.db
      .selectFrom('aiProviders')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  async createProvider(
    workspaceId: string,
    userId: string,
    dto: CreateAiProviderDto,
  ) {
    this.assertProviderConfigShape(dto.type, dto.baseUrl, dto.apiKeyEnvVar);

    return this.db
      .insertInto('aiProviders')
      .values({
        name: dto.name,
        type: dto.type,
        baseUrl: dto.baseUrl,
        apiKeyEnvVar: dto.apiKeyEnvVar,
        isEnabled: dto.isEnabled ?? true,
        capabilityFlags: dto.capabilityFlags ?? {},
        creatorId: userId,
        workspaceId,
      })
      .returningAll()
      .executeTakeFirst();
  }

  async updateProvider(workspaceId: string, dto: UpdateAiProviderDto) {
    const provider = await this.findProviderById(workspaceId, dto.providerId);
    if (!provider) {
      throw new NotFoundException('AI provider not found');
    }

    const baseUrl =
      typeof dto.baseUrl !== 'undefined' ? dto.baseUrl : provider.baseUrl;
    const apiKeyEnvVar =
      typeof dto.apiKeyEnvVar !== 'undefined'
        ? dto.apiKeyEnvVar
        : provider.apiKeyEnvVar;

    this.assertProviderConfigShape(provider.type, baseUrl, apiKeyEnvVar);

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (typeof dto.name !== 'undefined') {
      updateData.name = dto.name;
    }
    if (typeof dto.baseUrl !== 'undefined') {
      updateData.baseUrl = dto.baseUrl;
    }
    if (typeof dto.apiKeyEnvVar !== 'undefined') {
      updateData.apiKeyEnvVar = dto.apiKeyEnvVar;
    }
    if (typeof dto.isEnabled !== 'undefined') {
      updateData.isEnabled = dto.isEnabled;
    }
    if (typeof dto.capabilityFlags !== 'undefined') {
      updateData.capabilityFlags = dto.capabilityFlags;
    }

    return this.db
      .updateTable('aiProviders')
      .set(updateData)
      .where('id', '=', dto.providerId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteProvider(workspaceId: string, dto: DeleteAiProviderDto) {
    const provider = await this.findProviderById(workspaceId, dto.providerId);
    if (!provider) {
      throw new NotFoundException('AI provider not found');
    }

    await this.db
      .deleteFrom('aiProviders')
      .where('id', '=', dto.providerId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  async listModels(workspaceId: string, dto?: ListAiModelsDto) {
    let query = this.db
      .selectFrom('aiModels')
      .innerJoin('aiProviders', 'aiProviders.id', 'aiModels.providerId')
      .select([
        'aiModels.id',
        'aiModels.name',
        'aiModels.modelId',
        'aiModels.isEnabled',
        'aiModels.capabilityFlags',
        'aiModels.createdAt',
        'aiModels.updatedAt',
        'aiModels.providerId',
        'aiProviders.name as providerName',
        'aiProviders.type as providerType',
      ])
      .where('aiModels.workspaceId', '=', workspaceId)
      .where('aiProviders.workspaceId', '=', workspaceId)
      .where('aiModels.deletedAt', 'is', null)
      .where('aiProviders.deletedAt', 'is', null)
      .orderBy('aiModels.createdAt', 'asc');

    if (dto?.providerId) {
      query = query.where('aiModels.providerId', '=', dto.providerId);
    }

    return query.execute();
  }

  async createModel(
    workspaceId: string,
    userId: string,
    dto: CreateAiModelDto,
  ) {
    const provider = await this.findProviderById(workspaceId, dto.providerId);
    if (!provider) {
      throw new NotFoundException('AI provider not found');
    }

    return executeTx(this.db, async (trx) => {
      const createdModel = await trx
        .insertInto('aiModels')
        .values({
          name: dto.name,
          modelId: dto.modelId,
          isEnabled: dto.isEnabled ?? true,
          capabilityFlags: dto.capabilityFlags ?? {},
          creatorId: userId,
          providerId: dto.providerId,
          workspaceId,
        })
        .returningAll()
        .executeTakeFirst();

      if (dto.defaultTaskClasses?.length) {
        await this.upsertRoutesInternal(
          workspaceId,
          dto.defaultTaskClasses.map((taskClass) => ({
            taskClass,
            aiModelId: createdModel.id,
            routeOptions: {},
          })),
          trx,
        );
      }

      return createdModel;
    });
  }

  async updateModel(workspaceId: string, dto: UpdateAiModelDto) {
    const model = await this.findModelById(workspaceId, dto.aiModelId);
    if (!model) {
      throw new NotFoundException('AI model not found');
    }

    return executeTx(this.db, async (trx) => {
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
      };

      if (typeof dto.name !== 'undefined') {
        updateData.name = dto.name;
      }
      if (typeof dto.modelId !== 'undefined') {
        updateData.modelId = dto.modelId;
      }
      if (typeof dto.isEnabled !== 'undefined') {
        updateData.isEnabled = dto.isEnabled;
      }
      if (typeof dto.capabilityFlags !== 'undefined') {
        updateData.capabilityFlags = dto.capabilityFlags;
      }

      const updated = await trx
        .updateTable('aiModels')
        .set(updateData)
        .where('id', '=', dto.aiModelId)
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is', null)
        .returningAll()
        .executeTakeFirst();

      if (dto.defaultTaskClasses?.length) {
        await this.upsertRoutesInternal(
          workspaceId,
          dto.defaultTaskClasses.map((taskClass) => ({
            taskClass,
            aiModelId: dto.aiModelId,
            routeOptions: {},
          })),
          trx,
        );
      }

      return updated;
    });
  }

  async deleteModel(workspaceId: string, dto: DeleteAiModelDto) {
    const model = await this.findModelById(workspaceId, dto.aiModelId);
    if (!model) {
      throw new NotFoundException('AI model not found');
    }

    await this.db
      .deleteFrom('aiModels')
      .where('id', '=', dto.aiModelId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  async listTaskRoutes(workspaceId: string) {
    return this.db
      .selectFrom('aiTaskRoutes')
      .innerJoin('aiModels', 'aiModels.id', 'aiTaskRoutes.modelId')
      .innerJoin('aiProviders', 'aiProviders.id', 'aiModels.providerId')
      .select([
        'aiTaskRoutes.id',
        'aiTaskRoutes.taskClass',
        'aiTaskRoutes.routeOptions',
        'aiTaskRoutes.createdAt',
        'aiTaskRoutes.updatedAt',
        'aiModels.id as aiModelId',
        'aiModels.name as modelName',
        'aiModels.modelId as modelRef',
        'aiProviders.id as providerId',
        'aiProviders.name as providerName',
        'aiProviders.type as providerType',
      ])
      .where('aiTaskRoutes.workspaceId', '=', workspaceId)
      .where('aiModels.workspaceId', '=', workspaceId)
      .where('aiProviders.workspaceId', '=', workspaceId)
      .where('aiModels.deletedAt', 'is', null)
      .where('aiProviders.deletedAt', 'is', null)
      .orderBy('aiTaskRoutes.taskClass', 'asc')
      .execute();
  }

  async upsertTaskRoutes(workspaceId: string, dto: UpsertAiTaskRoutesDto) {
    await executeTx(this.db, async (trx) => {
      await this.upsertRoutesInternal(workspaceId, dto.routes, trx);
    });

    return this.listTaskRoutes(workspaceId);
  }

  async providerHealth(workspaceId: string, dto: ProviderHealthCheckDto) {
    if (!dto.providerId && dto.aiModelId) {
      throw new BadRequestException(
        'providerId is required when aiModelId is provided.',
      );
    }

    if (dto.providerId) {
      const provider = await this.findProviderById(workspaceId, dto.providerId);
      if (!provider) {
        throw new NotFoundException('AI provider not found');
      }

      let modelRef: string = undefined;
      if (dto.aiModelId) {
        const model = await this.findModelById(workspaceId, dto.aiModelId);
        if (!model) {
          throw new NotFoundException('AI model not found');
        }

        if (model.providerId !== provider.id) {
          throw new BadRequestException(
            'The requested model does not belong to the requested provider.',
          );
        }
        modelRef = model.modelId;
      }

      return this.providerGateway.verifyProviderHealth(provider, {
        modelId: modelRef,
      });
    }

    const providers = await this.listProviders(workspaceId);
    const checks = await Promise.all(
      providers.map((provider) =>
        this.providerGateway.verifyProviderHealth(provider),
      ),
    );
    return { checks };
  }

  private async findProviderById(workspaceId: string, providerId: string) {
    return this.db
      .selectFrom('aiProviders')
      .selectAll()
      .where('id', '=', providerId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  private async findModelById(workspaceId: string, aiModelId: string) {
    return this.db
      .selectFrom('aiModels')
      .selectAll()
      .where('id', '=', aiModelId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  private async upsertRoutesInternal(
    workspaceId: string,
    routes: {
      taskClass: string;
      aiModelId: string;
      routeOptions?: Record<string, any>;
    }[],
    trx: KyselyTransaction,
  ) {
    for (const route of routes) {
      if (!AI_TASK_CLASSES.includes(route.taskClass as any)) {
        throw new BadRequestException(
          `Unsupported task class "${route.taskClass}"`,
        );
      }

      const model = await trx
        .selectFrom('aiModels')
        .select(['id', 'workspaceId'])
        .where('id', '=', route.aiModelId)
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst();

      if (!model) {
        throw new NotFoundException(
          `AI model "${route.aiModelId}" was not found in this workspace.`,
        );
      }

      await trx
        .insertInto('aiTaskRoutes')
        .values({
          workspaceId,
          taskClass: route.taskClass,
          modelId: route.aiModelId,
          routeOptions: route.routeOptions ?? {},
        })
        .onConflict((oc) =>
          oc.columns(['workspaceId', 'taskClass']).doUpdateSet({
            modelId: route.aiModelId,
            routeOptions: route.routeOptions ?? {},
            updatedAt: new Date(),
          }),
        )
        .execute();
    }
  }

  private assertProviderConfigShape(
    type: string,
    baseUrl?: string,
    apiKeyEnvVar?: string,
  ) {
    if (type === 'openai') {
      if (!apiKeyEnvVar) {
        throw new BadRequestException(
          'OpenAI providers require an API key environment variable reference.',
        );
      }
      return;
    }

    if (type === 'openai-compatible') {
      if (!baseUrl) {
        throw new BadRequestException(
          'OpenAI-compatible providers require a base URL.',
        );
      }
      return;
    }

    if (type === 'ollama') {
      if (!baseUrl) {
        throw new BadRequestException('Ollama providers require a base URL.');
      }
      return;
    }

    throw new BadRequestException(`Unsupported provider type "${type}".`);
  }
}
