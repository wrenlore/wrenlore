import { GoogleOidcProvider } from './google-oidc.provider';

describe('GoogleOidcProvider', () => {
  function makeProvider(tokensetResult: unknown, callbackImpl?: jest.Mock) {
    const provider = new GoogleOidcProvider();
    const client = {
      authorizationUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?stub'),
      callback:
        callbackImpl ??
        jest.fn().mockResolvedValue(tokensetResult),
    };
    (provider as any).buildClient = jest.fn().mockResolvedValue(client);
    return { provider, client };
  }

  it('maps verified claims and drops tokens', async () => {
    const claims = {
      sub: 'google-sub-1',
      email: 'User@Example.com',
      email_verified: true,
      name: 'User One',
      access_token_hint: 'secret-token',
    };
    const { provider, client } = makeProvider({ claims: () => claims });

    const identity = await provider.resolveIdentity({
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'https://app.example.com/cb',
      code: 'code-1',
      state: 'st',
      codeVerifier: 'verifier',
      nonce: 'nonce-1',
    });

    expect(identity).toEqual({
      providerUserId: 'google-sub-1',
      email: 'user@example.com',
      emailVerified: true,
      displayName: 'User One',
    });
    // openid-client receives state, nonce and PKCE verifier for validation.
    expect(client.callback).toHaveBeenCalledWith(
      'https://app.example.com/cb',
      { code: 'code-1', state: 'st' },
      expect.objectContaining({
        state: 'st',
        nonce: 'nonce-1',
        code_verifier: 'verifier',
      }),
    );
  });

  it('marks the identity unverified when email_verified is false', async () => {
    const { provider } = makeProvider({
      claims: () => ({
        sub: 'google-sub-1',
        email: 'user@example.com',
        email_verified: false,
      }),
    });

    const identity = await provider.resolveIdentity({
      clientId: 'cid',
      clientSecret: 'secret',
      redirectUri: 'https://app.example.com/cb',
      code: 'code-1',
      state: 'st',
    });

    expect(identity.emailVerified).toBe(false);
  });

  it('fails when id_token validation throws', async () => {
    const { provider } = makeProvider(null, jest.fn().mockRejectedValue(new Error('id_token signature mismatch')));

    await expect(
      provider.resolveIdentity({
        clientId: 'cid',
        clientSecret: 'secret',
        redirectUri: 'https://app.example.com/cb',
        code: 'code-1',
        state: 'st',
      }),
    ).rejects.toThrow('Google identity response rejected.');
  });

  it('fails when the subject claim is missing', async () => {
    const { provider } = makeProvider({
      claims: () => ({ email: 'user@example.com', email_verified: true }),
    });

    await expect(
      provider.resolveIdentity({
        clientId: 'cid',
        clientSecret: 'secret',
        redirectUri: 'https://app.example.com/cb',
        code: 'code-1',
        state: 'st',
      }),
    ).rejects.toThrow('stable subject');
  });

  it('generates PKCE verifier with S256 challenge', () => {
    const verifier = GoogleOidcProvider.generateCodeVerifier();
    const challenge = GoogleOidcProvider.codeChallengeS256(verifier);
    expect(verifier.length).toBeGreaterThan(40);
    expect(challenge).toHaveLength(43); // base64url sha256
    expect(challenge).not.toBe(verifier);
  });
});
