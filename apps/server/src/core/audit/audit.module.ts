import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit.service';
import { AuditRetentionCleanupService } from './audit-retention-cleanup.service';
import { CaslModule } from '../casl/casl.module';

@Module({
  imports: [CaslModule],
  controllers: [AuditController],
  providers: [AuditQueryService, AuditRetentionCleanupService],
})
export class AuditLogModule {}
