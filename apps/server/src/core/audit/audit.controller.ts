import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@wrenlore/db/types/entity.types';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';
import { AuditLogsDto, UpdateAuditRetentionDto } from './dto/audit.dto';
import { AuditQueryService } from './audit.service';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';

@UseGuards(JwtAuthGuard)
@Controller('audit')
export class AuditController {
  constructor(
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly auditQueryService: AuditQueryService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('/')
  async getAuditLogs(
    @Body() dto: AuditLogsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.ensureAuditAccess(user, workspace);
    return this.auditQueryService.getAuditLogs(workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/retention')
  async getRetention(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.ensureAuditAccess(user, workspace);
    return this.auditQueryService.getRetention(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/retention/update')
  async updateRetention(
    @Body() dto: UpdateAuditRetentionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.ensureAuditAccess(user, workspace);
    await this.auditService.updateRetention(workspace.id, dto.auditRetentionDays);
    return {
      retentionDays: dto.auditRetentionDays,
    };
  }

  private ensureAuditAccess(user: User, workspace: Workspace) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Audit)) {
      throw new ForbiddenException();
    }
  }
}
