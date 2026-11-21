import { User, Workspace } from '@wrenlore/db/types/entity.types';

export interface AgentIdentity {
  tokenId: string;
  agentName: string;
  access: 'read' | 'write';
  spaceIds: string[] | null;
  user: User;
  workspace: Workspace;
}
