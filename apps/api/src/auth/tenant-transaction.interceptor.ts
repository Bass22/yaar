import { Injectable, UnauthorizedException, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { AfterCommitRequest, AfterCommitTask } from '../database/after-commit';
import { PrismaService } from '../database/prisma.service';
import type { Session, SessionRequest } from './session';

/**
 * Runs every request that has a session inside one transaction of its tenant: a handler that
 * calls `runInTenant` with the tenant of its session joins it, so the check below and the work
 * commit or roll back together. A handler that queries without `runInTenant` sees nothing
 * (row-level security, CLAUDE.md §4 rule 5). First, in that transaction, the account is read again: a blocked
 * account, a token issued before `sessions_valid_from`, a role that changed or an account that
 * does not exist in that tenant is refused — and the handler never runs.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<SessionRequest & AfterCommitRequest>();
    const { session, sessionIssuedAt } = request;
    if (session === undefined || sessionIssuedAt === undefined) {
      return next.handle();
    }
    const tasks: AfterCommitTask[] = [];
    request.afterCommit = tasks;
    return from(
      this.runThenCommit(session.tenantId, tasks, async (tx) => {
        const user = await tx.user.findUnique({ where: { id: session.userId }, select: { role: true, blockedAt: true, sessionsValidFrom: true } });
        // Rounded up to the second: a token issued in the same second as the invalidation is refused.
        const validFrom = user?.sessionsValidFrom === null || user === null ? null : Math.ceil(user.sessionsValidFrom.getTime() / 1_000);
        if (user === null || user.blockedAt !== null || user.role !== session.role || (validFrom !== null && sessionIssuedAt < validFrom)) {
          throw new UnauthorizedException();
        }
        return lastValueFrom(next.handle(), { defaultValue: undefined });
      }),
    );
  }

  /** Commits the work, then runs the tasks left for after the commit — only once it succeeded, out of the transaction, never awaited. */
  private async runThenCommit(tenantId: Session['tenantId'], tasks: AfterCommitTask[], work: Parameters<PrismaService['runInTenant']>[1]): Promise<unknown> {
    const result = await this.prisma.runInTenant(tenantId, work);
    for (const task of tasks) void this.prisma.detached(task).catch(() => undefined);
    return result;
  }
}
