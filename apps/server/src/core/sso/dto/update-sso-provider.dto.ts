import { Transform, TransformFnParams } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUrl, IsUUID, MaxLength, MinLength } from 'class-validator';

export class UpdateSsoProviderDto {
  @IsUUID()
  providerId: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  name?: string;

  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @Transform(({ value }: TransformFnParams) => value?.trim())
  samlUrl?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }: TransformFnParams) => value?.trim())
  samlCertificate?: string;

  @IsOptional()
  @IsBoolean()
  allowSignup?: boolean;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  groupSync?: boolean;
}
