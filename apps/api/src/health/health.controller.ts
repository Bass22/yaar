import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';

// Liveness probe: touches no dependency, so it stays green as long as the HTTP server is up.
// A readiness probe that pings the database arrives with the data layer (backlog D.1).
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
