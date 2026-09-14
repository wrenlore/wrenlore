import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { Reflector } from '@nestjs/core';
import { TransformHttpResponseInterceptor } from '../../common/interceptors/http-response.interceptor';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import { SamlAuthGuard } from './saml-auth.guard';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';

describe('SsoController SAML callbacks with Fastify adapter', () => {
  let app: NestFastifyApplication;
  let ssoService: {
    issueAuthCookieAndToken: jest.Mock;
    setAuthCookie: jest.Mock;
    buildPostLoginRedirect: jest.Mock;
  };

  const user = {
    id: 'user-id',
    workspaceId: 'workspace-id',
  };

  const samlGuard: CanActivate = {
    canActivate(context: ExecutionContext) {
      const req = context.switchToHttp().getRequest();
      req.user = user;
      return true;
    },
  };
  const jwtGuard: CanActivate = {
    canActivate: () => true,
  };

  beforeEach(async () => {
    ssoService = {
      issueAuthCookieAndToken: jest.fn().mockResolvedValue('jwt-token'),
      setAuthCookie: jest.fn((res, token) => {
        res.setCookie('authToken', token, {
          httpOnly: true,
          path: '/',
        });
      }),
      buildPostLoginRedirect: jest
        .fn()
        .mockImplementation(async (_user, relayState) =>
          relayState === '/space/docs'
            ? 'https://tenant.example.com/space/docs'
            : 'https://tenant.example.com/home',
        ),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SsoController],
      providers: [
        { provide: SsoService, useValue: ssoService },
        { provide: WorkspaceAbilityFactory, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuard)
      .overrideGuard(SamlAuthGuard)
      .useValue(samlGuard)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.register(fastifyCookie);
    app.useGlobalInterceptors(
      new TransformHttpResponseInterceptor(app.get(Reflector)),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('returns a real redirect and auth cookie for provider callbacks', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sso/saml/provider-id/callback',
      payload: { RelayState: '/space/docs' },
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(
      'https://tenant.example.com/space/docs',
    );
    expect(Buffer.byteLength(response.body)).toBe(0);
    expect(asHeaderArray(response.headers['set-cookie'])).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^authToken=jwt-token; Path=\/; HttpOnly/),
      ]),
    );
    expect(ssoService.buildPostLoginRedirect).toHaveBeenCalledWith(
      user,
      '/space/docs',
    );
  });

  it('returns a real redirect and auth cookie for the custom ACS callback', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sso/saml/custom-acs',
      payload: {},
    });

    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('https://tenant.example.com/home');
    expect(Buffer.byteLength(response.body)).toBe(0);
    expect(asHeaderArray(response.headers['set-cookie'])).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^authToken=jwt-token; Path=\/; HttpOnly/),
      ]),
    );
    expect(ssoService.buildPostLoginRedirect).toHaveBeenCalledWith(
      user,
      undefined,
    );
  });
});

function asHeaderArray(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}
