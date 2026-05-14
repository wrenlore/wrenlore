import { Injectable } from '@nestjs/common';

@Injectable()
export class LicenseCheckService {
  isValidEELicense(): boolean {
    return false;
  }

  hasFeature(_licenseKey: string, feature: string, _plan?: string): boolean {
    return this.getFeatures().includes(feature);
  }

  getFeatures(): string[] {
    return [
      'ai',
      'ai_search',
      'generative_ai',
      'comment_resolution',
      'disable_public_sharing',
      'trash_retention',
    ];
  }

  resolveFeatures(_licenseKey: string, _plan: string): string[] {
    return this.getFeatures();
  }

  resolveTier(_licenseKey: string, _plan: string): string {
    return 'wrenlore-core';
  }
}
