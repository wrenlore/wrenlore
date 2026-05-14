export interface IAuditLog {
  id: string | number;
  event: string;
  resourceType?: string;
  resourceId?: string;
  actorType?: string;
  actor?: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
  };
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string | Date;
}

export interface IAuditLogParams {
  limit?: number;
  cursor?: string | number | null;
  event?: string;
  resourceType?: string;
  actorId?: string;
  spaceId?: string;
  startDate?: string;
  endDate?: string;
}
