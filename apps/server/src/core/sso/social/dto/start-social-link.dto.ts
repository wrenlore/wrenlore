import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class StartSocialLinkDto {
  @IsString()
  @IsIn(['github', 'google'])
  providerType: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  redirect?: string;
}
