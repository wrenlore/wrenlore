import { IsUUID } from 'class-validator';

export class ProviderIdDto {
  @IsUUID()
  providerId: string;
}
