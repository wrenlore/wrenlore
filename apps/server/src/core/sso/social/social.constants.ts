export const SOCIAL_PROVIDER_TYPES = ['github', 'google'] as const;

export type SocialProviderType = (typeof SOCIAL_PROVIDER_TYPES)[number];

export function isSocialProviderType(value: unknown): value is SocialProviderType {
  return (
    typeof value === 'string' &&
    (SOCIAL_PROVIDER_TYPES as readonly string[]).includes(value)
  );
}

/** Lifetime of an in-flight OAuth state (authorization attempt). */
export const SOCIAL_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Window in which a session counts as "recently authenticated" for
 * connecting a social account from account settings.
 */
export const SOCIAL_LINK_RECENT_AUTH_TTL_S = 10 * 60;

export const SOCIAL_STATE_KEY_PREFIX = 'sso:social:state:';

export interface SocialIdentity {
  /** Stable provider account id (GitHub user id, Google `sub`). */
  providerUserId: string;
  /** Email as reported by the provider, if any. */
  email: string | null;
  /** Whether the provider asserts the email is verified. */
  emailVerified: boolean;
  displayName: string | null;
}

export interface SocialAuthorizeRequest {
  authorizeUrl: string;
  state: string;
}

export interface SocialProviderDriver {
  type: SocialProviderType;
  /** Build the provider authorization URL for an auth-code flow. */
  buildAuthorizeUrl(opts: {
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    state: string;
    codeVerifier?: string;
    nonce?: string;
  }): Promise<SocialAuthorizeRequest>;
  /**
   * Exchange the authorization code and resolve the verified identity.
   * Provider access tokens must not escape this method.
   */
  resolveIdentity(opts: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    state: string;
    codeVerifier?: string;
    nonce?: string;
  }): Promise<SocialIdentity>;
}
