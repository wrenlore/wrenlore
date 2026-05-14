import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ConfirmMfaSetupDto {
  @IsNotEmpty()
  @IsString()
  token: string;
}

export class DisableMfaDto {
  @IsNotEmpty()
  @MinLength(8)
  @IsString()
  currentPassword: string;
}

export class RegenerateMfaRecoveryCodesDto {
  @IsNotEmpty()
  @MinLength(8)
  @IsString()
  currentPassword: string;
}

export class CompleteMfaLoginDto {
  @IsNotEmpty()
  @IsString()
  mfaToken: string;

  @IsNotEmpty()
  @IsString()
  token: string;
}

export class CompleteMfaRecoveryLoginDto {
  @IsNotEmpty()
  @IsString()
  mfaToken: string;

  @IsNotEmpty()
  @IsString()
  recoveryCode: string;
}
