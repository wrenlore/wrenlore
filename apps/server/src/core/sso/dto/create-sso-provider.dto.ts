import { Transform, TransformFnParams } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const SSO_PROVIDER_TYPE = 'saml' as const;

export class CreateSsoProviderDto {
  @IsIn([SSO_PROVIDER_TYPE])
  type: typeof SSO_PROVIDER_TYPE;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  name: string;

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
