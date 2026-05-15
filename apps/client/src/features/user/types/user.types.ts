import {
  IMfaPolicy,
  IWorkspace,
} from "@/features/workspace/types/workspace.types";

export interface IUser {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: Date;
  avatarUrl: string;
  timezone: string;
  settings: IUserSettings;
  invitedById: string;
  lastLoginAt: string;
  lastActiveAt: Date;
  locale: string;
  createdAt: Date;
  updatedAt: Date;
  role: string;
  workspaceId: string;
  deactivatedAt: Date;
  deletedAt: Date;
  fullPageWidth: boolean; // used for update
  pageEditMode: string; // used for update
  hasGeneratedPassword?: boolean;
  mfa?: IUserMfa | null;
}

export interface IUserMfa {
  id: string;
  method: string;
  confirmedAt?: string | null;
  enabledAt?: string | null;
  createdAt?: string | null;
}

export interface ICurrentUser {
  user: IUser;
  workspace: IWorkspace;
  mfaPolicy?: IMfaPolicy;
}

export interface IUserSettings {
  preferences: {
    fullPageWidth: boolean;
    pageEditMode: string;
  };
}

export enum PageEditMode {
  Read = "read",
  Edit = "edit",
}
