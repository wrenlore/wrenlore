import { IsIn, IsString } from 'class-validator';

export class UnlinkSocialAccountDto {
  @IsString()
  @IsIn(['github', 'google'])
  providerType: string;
}
