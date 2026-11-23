import { Module } from '@nestjs/common';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';
import { SamlAuthGuard } from './saml-auth.guard';
import { WorkspaceModule } from '../workspace/workspace.module';
import { TokenModule } from '../auth/token.module';
import { SocialAuthController } from './social/social-auth.controller';
import { SocialAuthService } from './social/social-auth.service';
import { GithubOauthProvider } from './social/providers/github-oauth.provider';
import { GoogleOidcProvider } from './social/providers/google-oidc.provider';
import { MfaService } from '../auth/services/mfa.service';
import { AppSecretCryptoService } from '../../common/crypto/app-secret-crypto.service';

@Module({
  imports: [WorkspaceModule, TokenModule],
  controllers: [SsoController, SocialAuthController],
  providers: [
    SsoService,
    SamlAuthGuard,
    SocialAuthService,
    GithubOauthProvider,
    GoogleOidcProvider,
    MfaService,
    AppSecretCryptoService,
  ],
})
export class SsoModule {}
