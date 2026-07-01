import { Test, TestingModule } from '@nestjs/testing';
import { AUDIT_SERVICE } from '../../integrations/audit/audit.service';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { AuthController } from './auth.controller';
import { SetupGuard } from './guards/setup.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './services/auth.service';
import { MfaManagementService } from './services/mfa-management.service';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: MfaManagementService, useValue: {} },
        { provide: EnvironmentService, useValue: {} },
        { provide: AUDIT_SERVICE, useValue: { log: jest.fn() } },
      ],
    })
      .overrideGuard(SetupGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
