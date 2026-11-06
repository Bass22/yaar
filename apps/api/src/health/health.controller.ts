import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../database/prisma.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Liveness probe: touches no dependency, so it stays green as long as the HTTP server is up.
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // Readiness probe: green only when the database answers and the API is connected under a
  // role bound by row-level security — a deployment wired to a privileged role never receives
  // traffic. The reason of a failure is never sent back: the route is public.
  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    let restricted = false;
    try {
      restricted = await this.prisma.connectedAsRestrictedRole();
    } catch {
      restricted = false;
    }
    if (!restricted) {
      throw new ServiceUnavailableException();
    }
    return { status: 'ok' };
  }
}
