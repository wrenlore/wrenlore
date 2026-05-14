import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class GenerateAiTextDto {
  @IsNotEmpty()
  @IsString()
  prompt: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8192)
  maxTokens?: number;
}

export class GroundedAnswerDto {
  @IsNotEmpty()
  @IsString()
  query: string;

  @IsOptional()
  @IsUUID()
  spaceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number;
}

export class GenerateEmbeddingsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(256)
  @IsString({ each: true })
  input: string[];
}
