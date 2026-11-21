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
import { AuditEvent, AuditResource } from '../../common/events/audit-events';

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
    // Visibility is resolved and enforced server-side: workspace admins see
    // the whole workspace, space administrators only their spaces (#151).
    const visibility = await this.auditQueryService.resolveVisibility(
      user,
      workspace,
      this.canManageWorkspaceAudit(user, workspace),
    );
    return this.auditQueryService.getAuditLogs(user, workspace, dto, visibility);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/access')
  async getAccess(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.auditQueryService.getAccess(
      user,
      workspace,
      this.canManageWorkspaceAudit(user, workspace),
    );
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
    const previous = await this.auditQueryService.getRetention(workspace.id);
    await this.auditService.updateRetention(workspace.id, dto.auditRetentionDays);
    this.auditService.log({
      event: AuditEvent.AUDIT_RETENTION_UPDATED,
      resourceType: AuditResource.WORKSPACE,
      resourceId: workspace.id,
      changes: {
        before: { auditRetentionDays: previous.retentionDays },
        after: { auditRetentionDays: dto.auditRetentionDays },
      },
    });
    return {
      retentionDays: dto.auditRetentionDays,
    };
  }

  private canManageWorkspaceAudit(user: User, workspace: Workspace) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    return ability.can(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Audit);
  }

  private ensureAuditAccess(user: User, workspace: Workspace) {
    if (!this.canManageWorkspaceAudit(user, workspace)) {
      throw new ForbiddenException();
    }
  }
}
