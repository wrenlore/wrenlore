import { Transform, TransformFnParams } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const SSO_PROVIDER_TYPE = 'saml' as const;
export const SOCIAL_PROVIDER_TYPES_DTO = ['github', 'google'] as const;

export class CreateSsoProviderDto {
  @IsIn([SSO_PROVIDER_TYPE, ...SOCIAL_PROVIDER_TYPES_DTO])
  type: typeof SSO_PROVIDER_TYPE | (typeof SOCIAL_PROVIDER_TYPES_DTO)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  clientId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  clientSecret?: string;

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
