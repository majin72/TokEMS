import { Controller, Get, Inject, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConferenceRepository } from '../common/conference.repository.js';

@ApiTags('health')
@Controller('health')
class HealthController {
  constructor(@Inject(ConferenceRepository) private readonly repository: ConferenceRepository) {}

  @Get()
  health() {
    return this.repository.health();
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
