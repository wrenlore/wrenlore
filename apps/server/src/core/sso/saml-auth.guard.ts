import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FastifyRequest } from 'fastify';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { toSafeRelativePath } from './sso.utils';

@Injectable()
export class SamlAuthGuard extends AuthGuard('saml') {
  constructor(private readonly environmentService: EnvironmentService) {
    super();
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
