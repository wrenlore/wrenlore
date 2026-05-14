import { IsBoolean, IsString } from 'class-validator';

export class UpdateMfaPolicyDto {
  @IsBoolean()
  requireForLocalAccounts: boolean;
}

export class ResetMemberMfaDto {
  @IsString()
  userId: string;
}
