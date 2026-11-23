import { GithubOauthProvider } from './github-oauth.provider';

describe('GithubOauthProvider', () => {
  const provider = new GithubOauthProvider();
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    // Route the provider through the mock without touching global fetch.
    (provider as any).fetchImpl = fetchMock;
  });

  function jsonResponse(payload: unknown, ok = true) {
    return { ok, status: ok ? 200 : 400, json: async () => payload };
  }

  it('builds an authorize URL with identity scopes and state', async () => {
    const { authorizeUrl, state } = await provider.buildAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://app.example.com/api/auth/social/github/callback',
      state: 'xyz',
    });

    expect(state).toBe('xyz');
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('allow_signup')).toBe('false');
  });

  it('exchanges the code and resolves the verified primary email', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'ghp_token' }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 12345, login: 'octo', name: 'Octo Cat', email: 'public@github.com' }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { email: 'Old@Example.com', verified: false, primary: false },
          { email: 'Primary@Example.com', verified: true, primary: true },
        ]),
      );

    const identity = await provider.resolveIdentity({
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'https://app.example.com/cb',
      code: 'code-1',
      state: 'st',
    });

    expect(identity).toEqual({
      providerUserId: '12345',
      email: 'primary@example.com',
      emailVerified: true,
      displayName: 'Octo Cat',
    });

    // Token request carries the secret and code; never logged or returned.
    const tokenCall = fetchMock.mock.calls[0];
    expect(JSON.parse(tokenCall[1].body)).toMatchObject({
      client_id: 'cid',
      client_secret: 'secret',
      code: 'code-1',
    });
    // The access token must not leak into the identity result.
    expect(JSON.stringify(identity)).not.toContain('ghp_token');
  });

  it('treats the account-level email as unverified when the emails API fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'ghp_token' }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 7, login: 'octo', email: 'acct@example.com' }),
      )
      .mockResolvedValueOnce(jsonResponse({}, false));

    const identity = await provider.resolveIdentity({
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'https://app.example.com/cb',
      code: 'code-1',
      state: 'st',
    });

    expect(identity.email).toBe('acct@example.com');
    expect(identity.emailVerified).toBe(false);
  });

  it('rejects when the token exchange is refused', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'bad_verification_code' }),
    );

    await expect(
      provider.resolveIdentity({
        clientId: 'cid',
        clientSecret: 'secret',
        redirectUri: 'https://app.example.com/cb',
        code: 'bad',
        state: 'st',
      }),
    ).rejects.toThrow('GitHub authorization code rejected.');
  });
});
