import { Global, Module } from '@nestjs/common';
import { AUDIT_SERVICE, DatabaseAuditService } from './audit.service';

@Global()
@Module({
  providers: [
    {
      provide: AUDIT_SERVICE,
      useClass: DatabaseAuditService,
    },
  ],
  exports: [AUDIT_SERVICE],
})
export class AuditModule {}
