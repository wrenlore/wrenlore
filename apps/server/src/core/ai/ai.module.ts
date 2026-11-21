import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiRuntimeService } from './ai-runtime.service';
import { AiAdminService } from './ai-admin.service';
import { AiTaskRouterService } from './ai-task-router.service';
import { AiProviderGatewayService } from './ai-provider-gateway.service';
import { AiUrlSourceService } from './ai-url-source.service';
import { SearchModule } from '../search/search.module';
import { AppSecretCryptoService } from '../../common/crypto/app-secret-crypto.service';

@Module({
  imports: [SearchModule],
  controllers: [AiController],
  providers: [
    AiRuntimeService,
    AiAdminService,
    AiTaskRouterService,
    AiProviderGatewayService,
    AiUrlSourceService,
    AppSecretCryptoService,
  ],
})
export class AiModule {}
