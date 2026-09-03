import { Transform, TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  SAML_AUTHN_CONTEXT_COMPARISONS,
  SAML_HTTP_POST_BINDING,
  SAML_REQUESTED_AUTHN_CONTEXT_MODES,
  SamlAuthnContextComparison,
  SamlRequestedAuthnContextMode,
} from '../sso.utils';

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

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(SAML_REQUESTED_AUTHN_CONTEXT_MODES)
  requestedAuthnContextMode?: SamlRequestedAuthnContextMode;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(2048, { each: true })
  @Transform(({ value }: TransformFnParams) =>
    Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' ? item.trim() : item))
      : value,
  )
  requestedAuthnContextClassRefs?: string[];

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(SAML_AUTHN_CONTEXT_COMPARISONS)
  requestedAuthnContextComparison?: SamlAuthnContextComparison;

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
