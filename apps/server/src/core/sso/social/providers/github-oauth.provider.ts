import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  SocialAuthorizeRequest,
  SocialIdentity,
  SocialProviderDriver,
} from '../social.constants';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';
// Identity-only scopes: profile + verified email addresses.
const GITHUB_SCOPES = 'read:user user:email';

@Injectable()
export class GithubOauthProvider implements SocialProviderDriver {
  readonly type = 'github' as const;

  private readonly logger = new Logger(GithubOauthProvider.name);

  async buildAuthorizeUrl(opts: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeVerifier?: string;
  }): Promise<SocialAuthorizeRequest> {
    if (!opts.codeVerifier)
      throw new BadRequestException('PKCE verifier is required.');
    const url = new URL(GITHUB_AUTHORIZE_URL);
    url.searchParams.set('client_id', opts.clientId);
    url.searchParams.set('redirect_uri', opts.redirectUri);
    url.searchParams.set('scope', GITHUB_SCOPES);
    url.searchParams.set('state', opts.state);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set(
      'code_challenge',
      createHash('sha256').update(opts.codeVerifier).digest('base64url'),
    );
    url.searchParams.set('allow_signup', 'false');

    return { authorizeUrl: url.toString(), state: opts.state };
  }

  async resolveIdentity(opts: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    state: string;
    codeVerifier?: string;
  }): Promise<SocialIdentity> {
    const accessToken = await this.exchangeCode(opts);

    try {
      const account = await this.githubFetchJson(
        `${GITHUB_API_URL}/user`,
        accessToken,
      );

      const providerUserId = String(account?.id ?? '').trim();
      if (!providerUserId || providerUserId === 'undefined') {
        throw new BadRequestException(
          'GitHub did not return a stable account identifier.',
        );
      }

      const displayName =
        this.firstNonEmptyString(account?.name) ??
        this.firstNonEmptyString(account?.login);

      const { email, emailVerified } = await this.resolvePrimaryEmail(
        accessToken,
        this.firstNonEmptyString(account?.email),
      );

      return {
        providerUserId,
        email,
        emailVerified,
        displayName,
      };
    } finally {
      // The access token is intentionally dropped here; WrenLore never
      // stores or forwards provider tokens.
    }
  }

  private async exchangeCode(opts: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    codeVerifier?: string;
  }): Promise<string> {
    if (!opts.codeVerifier)
      throw new BadRequestException('PKCE verifier is required.');
    const response = await this.fetchImpl(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        code: opts.code,
        code_verifier: opts.codeVerifier,
        redirect_uri: opts.redirectUri,
      }),
    });

    if (!response.ok) {
      this.logger.warn(
        `GitHub token exchange failed with status ${response.status}`,
      );
      throw new BadRequestException('GitHub authorization code rejected.');
    }

    const payload = (await response.json().catch(() => null)) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    } | null;

    if (!payload?.access_token) {
      this.logger.warn(
        `GitHub token exchange rejected: ${payload?.error ?? 'unknown'}`,
      );
      throw new BadRequestException('GitHub authorization code rejected.');
    }

    return payload.access_token;
  }

  private async resolvePrimaryEmail(
    accessToken: string,
    fallbackEmail: string | null,
  ): Promise<{ email: string | null; emailVerified: boolean }> {
    try {
      const emails = await this.githubFetchJson(
        `${GITHUB_API_URL}/user/emails`,
        accessToken,
      );

      if (Array.isArray(emails)) {
        const verified = emails.filter(
          (entry: any) =>
            entry &&
            entry.verified === true &&
            typeof entry.email === 'string' &&
            entry.email.includes('@'),
        );
        const primary =
          verified.find((entry: any) => entry.primary === true) ?? verified[0];
        if (primary) {
          return {
            email: String(primary.email).toLowerCase(),
            emailVerified: true,
          };
        }
      }
    } catch (error) {
      this.logger.warn(
        `GitHub email lookup failed: ${(error as Error).message}`,
      );
    }

    // The account-level email is not guaranteed to be verified; treat it as
    // unverified so signup is never based on an unverified address.
    return {
      email: fallbackEmail?.toLowerCase() ?? null,
      emailVerified: false,
    };
  }

  private async githubFetchJson(url: string, accessToken: string) {
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      throw new BadRequestException(
        `GitHub API request failed with status ${response.status}`,
      );
    }

    return response.json().catch(() => null);
  }

  private firstNonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private async fetchImpl(input: string, init: RequestInit): Promise<Response> {
    return fetch(input, init);
  }
}
