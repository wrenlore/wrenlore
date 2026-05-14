import { Injectable } from '@nestjs/common';
import { Interval, SchedulerRegistry } from '@nestjs/schedule';

@Injectable()
export class TelemetryService {
  constructor(private schedulerRegistry: SchedulerRegistry) {}

  @Interval('telemetry', 24 * 60 * 60 * 1000)
  async sendTelemetry() {
    this.schedulerRegistry.deleteInterval('telemetry');
  }
}
