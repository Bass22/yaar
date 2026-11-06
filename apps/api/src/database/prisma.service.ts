import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantId } from '@domain/journal';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

/** The tenant transaction in scope, if any. */
type TenantScope = { readonly tx: Prisma.TransactionClient; readonly tenantId: TenantId };

// The single Prisma client of the API. It connects on the first query, not at boot: a
// database that restarts does not take the API down with it, and the readiness probe says
// whether it answers. Adapted from build-track (prisma.service.ts).
//
// The API connects as a role subject to row-level security, so a query made outside
// `runInTenant` sees no row and writes none: forgetting the tenant fails closed.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly tenantScope = new AsyncLocalStorage<TenantScope>();

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ datasources: { db: { url: config.databaseUrl } } });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `work` in one transaction scoped to a tenant. The tenant is set for the transaction
   * only (`set_config(..., true)`, the parameterised form of SET LOCAL): it reverts at commit
   * or rollback, so a pooled connection never carries a tenant to the next request.
   *
   * Re-entrant: a nested call for the same tenant joins the transaction already open, so a use
   * case and what it calls commit or roll back together. A nested call for another tenant is
   * refused: it would write under the wrong farm without anyone noticing.
   */
  async runInTenant<T>(tenantId: TenantId, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const current = this.tenantScope.getStore();
    if (current !== undefined) {
      if (current.tenantId !== tenantId) {
        throw new Error('A tenant transaction cannot be nested inside the transaction of another tenant.');
      }
      return work(current.tx);
    }
    return this.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return this.tenantScope.run({ tx, tenantId }, () => work(tx));
    });
  }

  /**
   * Whether the role the API is connected as is the kind it must be: bound by row-level
   * security, and unable to undo it. A superuser or a BYPASSRLS role reads every farm on any
   * query that forgot its tenant; a role that owns a table, or may create one, can drop a
   * policy or a trigger of the journal.
   */
  async connectedAsRestrictedRole(): Promise<boolean> {
    const roles = await this.$queryRaw<{ privileged: boolean }[]>`
      SELECT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb
              OR has_schema_privilege(r.oid, 'public', 'CREATE')
              OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'public' AND c.relowner = r.oid)) AS privileged
        FROM pg_roles r WHERE r.rolname = current_user`;
    return roles.length === 1 && roles[0]?.privileged === false;
  }
}
