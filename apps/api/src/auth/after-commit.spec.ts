import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import type { AfterCommitRequest } from '../database/after-commit';
import type { PrismaService } from '../database/prisma.service';
import { TenantTransactionInterceptor } from './tenant-transaction.interceptor';

// Spec: backlog Y.2a — une notification part après la validation : une écriture annulée ne
// prévient personne. La transaction est simulée : elle valide si la route réussit, annule sinon.

describe('Ce qui attend la validation de la requête', () => {
  const journal: string[] = [];
  const prisma = {
    runInTenant: async (_tenant: string, work: (tx: unknown) => Promise<unknown>) => {
      const tx = { user: { findUnique: async () => ({ role: 'admin', blockedAt: null, sessionsValidFrom: null }) } };
      const result = await work(tx);
      journal.push('validée');
      return result;
    },
    detached: <T>(work: () => Promise<T>) => work(),
  } as unknown as PrismaService;
  const request: AfterCommitRequest & { session: unknown; sessionIssuedAt: number } = { session: { tenantId: 't', userId: 'u', role: 'admin', deviceId: 'd' }, sessionIssuedAt: 1 };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  const route = (outcome: 'réussit' | 'échoue'): CallHandler => ({
    handle: () => {
      request.afterCommit?.push(async () => {
        journal.push('notification');
      });
      journal.push('route');
      return outcome === 'réussit' ? of('ok') : throwError(() => new Error('refusé'));
    },
  });

  beforeEach(() => {
    journal.length = 0;
  });

  it('la route réussit : la notification part après la validation, jamais avant', async () => {
    await lastValueFrom(new TenantTransactionInterceptor(prisma).intercept(context, route('réussit')));
    await new Promise((resolve) => setImmediate(resolve));

    expect(journal).toEqual(['route', 'validée', 'notification']);
  });

  it('la route échoue après avoir prévu la notification : rien ne part', async () => {
    await expect(lastValueFrom(new TenantTransactionInterceptor(prisma).intercept(context, route('échoue')))).rejects.toThrow('refusé');
    await new Promise((resolve) => setImmediate(resolve));

    expect(journal).toEqual(['route']);
  });
});
