import { SSO_PROVIDER } from "@/features/auth/sso/constants.ts";

export interface IAuthProvider {
  id: string;
  name: string;
  type: SSO_PROVIDER;
  samlUrl: string;
  samlCertificate: string;
  spEntityId: string | null;
  spAcsUrl: string | null;
  spAcsPath: string | null;
  spAcsBinding: string | null;
  spSloUrl: string | null;
  nameIdFormat: string | null;
  idpEntityId: string | null;
  idpSloUrl: string | null;
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret: string;
  ldapUrl: string;
  ldapBindDn: string;
  ldapBindPassword: string;
  ldapBaseDn: string;
  ldapUserSearchFilter: string;
  ldapUserAttributes: any;
  ldapTlsEnabled: boolean;
  ldapTlsCaCert: string;
  allowSignup: boolean;
  isEnabled: boolean;
  groupSync: boolean;
  creatorId: string;
  workspaceId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date;
  providerId: string;
}
