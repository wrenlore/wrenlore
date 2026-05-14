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
