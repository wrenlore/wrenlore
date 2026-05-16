import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { AI_PROVIDER_TYPES, AI_TASK_CLASSES } from '../ai.constants';

const ENV_VAR_REFERENCE_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export class CreateAiProviderDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsIn(AI_PROVIDER_TYPES)
  type: (typeof AI_PROVIDER_TYPES)[number];

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(ENV_VAR_REFERENCE_PATTERN)
  apiKeyEnvVar?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsObject()
  capabilityFlags?: Record<string, any>;
}

export class UpdateAiProviderDto {
  @IsUUID()
  providerId: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(ENV_VAR_REFERENCE_PATTERN)
  apiKeyEnvVar?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsObject()
  capabilityFlags?: Record<string, any>;
}

export class DeleteAiProviderDto {
  @IsUUID()
  providerId: string;
}

export class CreateAiModelDto {
  @IsUUID()
  providerId: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  modelId: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsObject()
  capabilityFlags?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @IsIn(AI_TASK_CLASSES, { each: true })
  defaultTaskClasses?: (typeof AI_TASK_CLASSES)[number][];
}

export class UpdateAiModelDto {
  @IsUUID()
  aiModelId: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsObject()
  capabilityFlags?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @IsIn(AI_TASK_CLASSES, { each: true })
  defaultTaskClasses?: (typeof AI_TASK_CLASSES)[number][];
}

export class DeleteAiModelDto {
  @IsUUID()
  aiModelId: string;
}

export class ListAiModelsDto {
  @IsOptional()
  @IsUUID()
  providerId?: string;
}

export class DiscoverAiModelsDto {
  @IsUUID()
  providerId: string;
}

export class UpsertAiTaskRouteItemDto {
  @IsIn(AI_TASK_CLASSES)
  taskClass: (typeof AI_TASK_CLASSES)[number];

  @IsUUID()
  aiModelId: string;

  @IsOptional()
  @IsObject()
  routeOptions?: Record<string, any>;
}

export class UpsertAiTaskRoutesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => UpsertAiTaskRouteItemDto)
  routes: UpsertAiTaskRouteItemDto[];
}

export class ProviderHealthCheckDto {
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsOptional()
  @IsUUID()
  aiModelId?: string;
}
