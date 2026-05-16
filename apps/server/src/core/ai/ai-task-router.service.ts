import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';
import { AI_TASK_CLASS_FALLBACKS, AiTaskClass } from './ai.constants';
import { AiResolvedRoute } from './ai.types';
import { EnvironmentService } from '../../integrations/environment/environment.service';

@Injectable()
export class AiTaskRouterService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
  ) {}

  async resolveRoute(
    workspaceId: string,
    taskClass: AiTaskClass,
  ): Promise<AiResolvedRoute> {
    const candidateTaskClasses = [
      taskClass,
      ...(AI_TASK_CLASS_FALLBACKS[taskClass] ?? []),
    ];

    for (const candidate of candidateTaskClasses) {
      const resolved = await this.resolveCandidate(workspaceId, candidate);
      if (resolved) {
        return {
          ...resolved,
          requestedTaskClass: taskClass,
          resolvedTaskClass: candidate,
        };
      }

      const envResolved = this.resolveEnvCandidate(workspaceId, candidate);
      if (envResolved) {
        return {
          ...envResolved,
          requestedTaskClass: taskClass,
          resolvedTaskClass: candidate,
        };
      }
    }

    throw new BadRequestException(
      `No enabled AI route configured for task class "${taskClass}" in this workspace.`,
    );
  }

  private async resolveCandidate(
    workspaceId: string,
    taskClass: AiTaskClass,
  ): Promise<Omit<AiResolvedRoute, 'requestedTaskClass' | 'resolvedTaskClass'>> {
    const row = await this.db
      .selectFrom('aiTaskRoutes as routes')
      .innerJoin('aiModels as models', 'models.id', 'routes.modelId')
      .innerJoin('aiProviders as providers', 'providers.id', 'models.providerId')
      .select([
        'routes.id as routeId',
        'routes.routeOptions as routeOptions',
        'models.id as modelId',
        'models.name as modelName',
        'models.modelId as modelRef',
        'models.isEnabled as modelEnabled',
        'models.capabilityFlags as modelCapabilityFlags',
        'models.creatorId as modelCreatorId',
        'models.workspaceId as modelWorkspaceId',
        'models.createdAt as modelCreatedAt',
        'models.updatedAt as modelUpdatedAt',
        'models.deletedAt as modelDeletedAt',
        'providers.id as providerId',
        'providers.name as providerName',
        'providers.type as providerType',
        'providers.baseUrl as providerBaseUrl',
        'providers.apiKeyEnvVar as providerApiKeyEnvVar',
        'providers.encryptedApiKey as providerEncryptedApiKey',
        'providers.isEnabled as providerEnabled',
        'providers.capabilityFlags as providerCapabilityFlags',
        'providers.creatorId as providerCreatorId',
        'providers.workspaceId as providerWorkspaceId',
        'providers.createdAt as providerCreatedAt',
        'providers.updatedAt as providerUpdatedAt',
        'providers.deletedAt as providerDeletedAt',
      ])
      .where('routes.workspaceId', '=', workspaceId)
      .where('routes.taskClass', '=', taskClass)
      .where('models.workspaceId', '=', workspaceId)
      .where('providers.workspaceId', '=', workspaceId)
      .where('models.deletedAt', 'is', null)
      .where('providers.deletedAt', 'is', null)
      .where('models.isEnabled', '=', true)
      .where('providers.isEnabled', '=', true)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return {
      routeId: row.routeId,
      routeOptions: (row.routeOptions ?? {}) as Record<string, any>,
      model: {
        id: row.modelId,
        name: row.modelName,
        modelId: row.modelRef,
        providerId: row.providerId,
        isEnabled: row.modelEnabled,
        capabilityFlags: row.modelCapabilityFlags,
        creatorId: row.modelCreatorId,
        workspaceId: row.modelWorkspaceId,
        createdAt: row.modelCreatedAt,
        updatedAt: row.modelUpdatedAt,
        deletedAt: row.modelDeletedAt,
      },
      provider: {
        id: row.providerId,
        name: row.providerName,
        type: row.providerType,
        baseUrl: row.providerBaseUrl,
        apiKeyEnvVar: row.providerApiKeyEnvVar,
        encryptedApiKey: row.providerEncryptedApiKey,
        isEnabled: row.providerEnabled,
        capabilityFlags: row.providerCapabilityFlags,
        creatorId: row.providerCreatorId,
        workspaceId: row.providerWorkspaceId,
        createdAt: row.providerCreatedAt,
        updatedAt: row.providerUpdatedAt,
        deletedAt: row.providerDeletedAt,
      },
    };
  }

  private resolveEnvCandidate(
    workspaceId: string,
    taskClass: AiTaskClass,
  ): Omit<AiResolvedRoute, 'requestedTaskClass' | 'resolvedTaskClass'> | null {
    const providerType = this.environmentService.getAiDriver();
    const modelId = this.environmentService.getAiCompletionModel();

    if (!providerType || !modelId) {
      return null;
    }

    if (
      taskClass !== 'text-generation' &&
      taskClass !== 'streaming-generation' &&
      taskClass !== 'grounded-answer-generation'
    ) {
      return null;
    }

    const now = new Date();
    const providerBaseUrl =
      providerType === 'ollama'
        ? this.environmentService.getOllamaApiUrl()
        : this.environmentService.getOpenAiApiUrl();
    const apiKeyEnvVar =
      providerType === 'openai'
        ? 'OPENAI_API_KEY'
        : providerType === 'openai-compatible'
          ? 'OPENAI_API_KEY'
          : null;

    return {
      routeId: `env:${taskClass}`,
      routeOptions: { source: 'environment' },
      provider: {
        id: `env:${providerType}`,
        name: `Environment ${providerType}`,
        type: providerType,
        baseUrl: providerBaseUrl,
        apiKeyEnvVar,
        encryptedApiKey: null,
        isEnabled: true,
        capabilityFlags: {},
        creatorId: null,
        workspaceId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      } as any,
      model: {
        id: `env:${modelId}`,
        name: modelId,
        modelId,
        providerId: `env:${providerType}`,
        isEnabled: true,
        capabilityFlags: {},
        creatorId: null,
        workspaceId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      } as any,
    };
  }
}
