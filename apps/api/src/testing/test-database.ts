import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Test support: a fresh, empty database on a real, disposable PostgreSQL (Testcontainers),
// with the committed migrations applied — so the migration SQL itself stays under test.
// Infrastructure tests run against PostgreSQL itself (row-level security, constraints,
// triggers): a stub would prove nothing. Adapted from build-track (test-database.ts).
//
// One container for the whole run, started and migrated once by Jest's global setup
// (apps/api/jest.test-containers.js), one database per spec file, copied from the migrated
// template (CREATE DATABASE … TEMPLATE). A container kept here in a module variable was started
// anew for every spec file — Jest loads modules per file — and saturated the machine.

export type TestDatabase = {
  /** Connection string of the owner of the tables, the role that ran the migrations (D.6). */
  readonly url: string;
  /**
   * The owner of the tables, as in production: neither superuser nor BYPASSRLS, so the forced
   * row-level security binds it — the operator's scripts run under it.
   */
  readonly owner: PrismaClient;
  /** The superuser of the cluster: seeds and reads across farms. Tests only; no task of the stack runs under one. */
  readonly superuser: PrismaClient;
  readonly superuserUrl: string;
  /** The same database, reached as the role the API runs under: bound by row-level security. */
  readonly appUrl: string;
  drop(): Promise<void>;
};

// The roles and the template, as the global setup made them (apps/api/jest.test-containers.js).
const { OWNER_ROLE, OWNER_ROLE_PASSWORD, APP_ROLE, APP_ROLE_PASSWORD, TEMPLATE } = createRequire(__filename)('../../jest.test-containers.js') as {
  OWNER_ROLE: string;
  OWNER_ROLE_PASSWORD: string;
  APP_ROLE: string;
  APP_ROLE_PASSWORD: string;
  TEMPLATE: string;
};
const prismaConfig = resolve(__dirname, '../../prisma.config.ts');
const clientFor = (url: string): PrismaClient => new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
// The CLI installed in node_modules, not `npx`: no package lookup, no network.
const prismaCli = createRequire(__filename).resolve('prisma/build/index.js');
let created = 0;
// PostgreSQL refuses to copy a template while another copy of it starts (55006): the spec files
// of the workers start together, so a copy waits its turn.
const TEMPLATE_BUSY = /55006|being accessed by other users/;

async function onCluster<T>(clusterUrl: string, work: (cluster: PrismaClient) => Promise<T>): Promise<T> {
  const cluster = clientFor(clusterUrl);
  try {
    return await work(cluster);
  } finally {
    await cluster.$disconnect();
  }
}

function clusterOfThisRun(): string {
  const url = process.env['YAAR_TEST_CLUSTER_URL'];
  if (url === undefined || url === '') {
    throw new Error('The test run has no PostgreSQL: run the API tests through apps/api/jest.config.js.');
  }
  return url;
}

function asRole(clusterUrl: string, database: string, role: string, password: string): string {
  const url = new URL(clusterUrl);
  url.pathname = `/${database}`;
  url.username = role;
  url.password = password;
  return url.toString();
}

export function migrate(databaseUrl: string): void {
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--config', prismaConfig], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const clusterUrl = clusterOfThisRun();
  // Unique per Jest worker (a process) and per spec file (a counter).
  const name = `yaar_test_${process.pid}_${++created}`;
  // A copy of the migrated template.
  const statement = `CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE}" OWNER ${OWNER_ROLE}`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await onCluster(clusterUrl, (cluster) => cluster.$executeRawUnsafe(statement));
      break;
    } catch (error) {
      if (attempt >= 50 || !TEMPLATE_BUSY.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));
    }
  }

  const superuserUrl = new URL(clusterUrl);
  superuserUrl.pathname = `/${name}`;
  const url = asRole(clusterUrl, name, OWNER_ROLE, OWNER_ROLE_PASSWORD);
  const owner = clientFor(url);
  const superuser = clientFor(superuserUrl.toString());

  return {
    url,
    owner,
    superuser,
    superuserUrl: superuserUrl.toString(),
    appUrl: asRole(clusterUrl, name, APP_ROLE, APP_ROLE_PASSWORD),
    async drop() {
      await owner.$disconnect();
      await superuser.$disconnect();
      await onCluster(clusterUrl, (cluster) => cluster.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    },
  };
}
