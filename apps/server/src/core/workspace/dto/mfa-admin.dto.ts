import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateMfaPolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsBoolean()
  requireForLocalAccounts: boolean;
}

export class ResetMemberMfaDto {
  @IsString()
  userId: string;
}
