import {
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FastifyRequest } from 'fastify';
import { isObservable, lastValueFrom } from 'rxjs';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { toSafeRelativePath } from './sso.utils';
import { SsoService } from './sso.service';

@Injectable()
export class SamlAuthGuard extends AuthGuard('saml') {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly ssoService: SsoService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const params = (req.params ?? {}) as Record<string, string>;

    if (!params.providerId) {
      const hasSamlResponse = Boolean(
        (req.body as Record<string, unknown> | undefined)?.['SAMLResponse'] ||
          (req.query as Record<string, unknown> | undefined)?.['SAMLResponse'],
      );

      if (!hasSamlResponse) {
        throw new NotFoundException('SAML callback not found.');
      }

      params.providerId = await this.ssoService.resolveProviderIdForAcs(req);
      (req as any).params = params;
    }

    const result = super.canActivate(context);
    if (isObservable(result)) {
      return lastValueFrom(result);
    }
    return Promise.resolve(result);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const options: Record<string, unknown> = {
      session: false,
    };

    const hasSamlResponse = Boolean(
      (req.body as Record<string, unknown> | undefined)?.['SAMLResponse'] ||
        (req.query as Record<string, unknown> | undefined)?.['SAMLResponse'],
    );

    if (!hasSamlResponse) {
      const redirect = toSafeRelativePath(
        (req.query as Record<string, unknown> | undefined)?.['redirect'],
        this.environmentService.getAppUrl(),
      );

      if (redirect) {
        options.additionalParams = {
          RelayState: redirect,
        };
      }
    }

    return options;
  }
}
