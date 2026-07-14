import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SAML_HTTP_POST_BINDING } from '../sso.utils';

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
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  spEntityId?: string | null;

  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  spAcsUrl?: string | null;

  @IsOptional()
  @IsIn([SAML_HTTP_POST_BINDING])
  spAcsBinding?: typeof SAML_HTTP_POST_BINDING | null;

  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  spSloUrl?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  nameIdFormat?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  idpEntityId?: string | null;

  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  @Transform(({ value }: TransformFnParams) => value?.trim())
  idpSloUrl?: string | null;

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
