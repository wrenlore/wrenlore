export interface IApiKey {
  id: string;
  name: string;
  keyPrefix?: string;
  createdAt?: string | Date;
  lastUsedAt?: string | Date | null;
}
