import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EnvironmentService } from './environment.service';

describe('EnvironmentService', () => {
  let service: EnvironmentService;
  let config: Record<string, string>;

  beforeEach(async () => {
    config = {};
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnvironmentService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string, defaultValue?: string) =>
                config[key] ?? defaultValue,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<EnvironmentService>(EnvironmentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('keeps demo mode disabled by default', () => {
    expect(service.isDemoMode()).toBe(false);
  });

  it('exposes the configured public demo details only when requested', () => {
    config = {
      DEMO_MODE: 'true',
      DEMO_EMAIL: 'demo@example.com',
      DEMO_PASSWORD: 'demo-password',
      DEMO_RESET_SCHEDULE: 'every 6 hours',
    };

    expect(service.isDemoMode()).toBe(true);
    expect(service.getDemoEmail()).toBe('demo@example.com');
    expect(service.getDemoPassword()).toBe('demo-password');
    expect(service.getDemoResetSchedule()).toBe('every 6 hours');
  });
});
