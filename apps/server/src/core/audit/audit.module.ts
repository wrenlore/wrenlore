import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit.service';
import { CaslModule } from '../casl/casl.module';

@Module({
  imports: [CaslModule],
  controllers: [AuditController],
  providers: [AuditQueryService],
})
export class AuditLogModule {}
