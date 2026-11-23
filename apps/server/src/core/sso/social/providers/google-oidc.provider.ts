import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Client, Issuer } from 'openid-client';
import {
  SocialAuthorizeRequest,
  SocialIdentity,
  SocialProviderDriver,
} from '../social.constants';

const GOOGLE_ISSUER = 'https://accounts.google.com';
// Identity-only scopes: subject + verified email + basic profile.
const GOOGLE_SCOPES = 'openid email profile';

let cachedIssuer: Issuer | null = null;

@Injectable()
export class GoogleOidcProvider implements SocialProviderDriver {
  readonly type = 'google' as const;

  private readonly logger = new Logger(GoogleOidcProvider.name);

  static generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  static codeChallengeS256(codeVerifier: string): string {
    return createHash('sha256').update(codeVerifier).digest('base64url');
  }

  static generateNonce(): string {
    return randomBytes(24).toString('base64url');
  }

  async buildAuthorizeUrl(opts: {
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    state: string;
    codeVerifier?: string;
    nonce?: string;
  }): Promise<SocialAuthorizeRequest> {
    const client = await this.buildClient(opts.clientId, opts.clientSecret ?? '');

    const authorizationUrl = client.authorizationUrl({
      redirect_uri: opts.redirectUri,
      scope: GOOGLE_SCOPES,
      state: opts.state,
      nonce: opts.nonce,
      prompt: 'select_account',
      ...(opts.codeVerifier
        ? {
            code_challenge: GoogleOidcProvider.codeChallengeS256(
              opts.codeVerifier,
            ),
            code_challenge_method: 'S256',
          }
        : {}),
    });

    return { authorizeUrl: authorizationUrl, state: opts.state };
  }

  async resolveIdentity(opts: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    state: string;
    codeVerifier?: string;
    nonce?: string;
  }): Promise<SocialIdentity> {
    const client = await this.buildClient(opts.clientId, opts.clientSecret);

    let tokenset;
    try {
      // openid-client validates the id_token signature against the Google
      // JWKS plus issuer, audience, expiry, state, nonce and PKCE.
      tokenset = await client.callback(
        opts.redirectUri,
        { code: opts.code, state: opts.state },
        {
          state: opts.state,
          nonce: opts.nonce,
          code_verifier: opts.codeVerifier,
          response_mode: 'query',
        } as any,
      );
    } catch (error) {
      this.logger.warn(
        `Google id_token validation failed: ${(error as Error).message}`,
      );
      throw new BadRequestException('Google identity response rejected.');
    } finally {
      // tokenset (access/refresh/id tokens) is intentionally dropped after
      // the claims are read below.
    }

    const claims = (tokenset?.claims?.() ?? {}) as {
      sub?: unknown;
      email?: unknown;
      email_verified?: unknown;
      name?: unknown;
    };

    const providerUserId =
      typeof claims.sub === 'string' ? claims.sub.trim() : '';
    if (!providerUserId) {
      throw new BadRequestException(
        'Google identity is missing a stable subject identifier.',
      );
    }

    const email =
      typeof claims.email === 'string' && claims.email.includes('@')
        ? claims.email.toLowerCase()
        : null;
    const emailVerified = claims.email_verified === true && !!email;

    const displayName =
      typeof claims.name === 'string' && claims.name.trim().length > 0
        ? claims.name.trim()
        : null;

    return { providerUserId, email, emailVerified, displayName };
  }

  private async buildClient(
    clientId: string,
    clientSecret: string,
  ): Promise<Client> {
    const issuer = await this.ensureIssuer();
    return new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
    });
  }

  async ensureIssuer(): Promise<Issuer> {
    if (!cachedIssuer) {
      cachedIssuer = await this.discoverIssuer();
    }
    return cachedIssuer;
  }

  protected async discoverIssuer(): Promise<Issuer> {
    return Issuer.discover(GOOGLE_ISSUER);
  }
}
