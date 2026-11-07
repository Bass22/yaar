import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Test support: a fresh, empty database on a real, disposable PostgreSQL (Testcontainers),
// with the committed migrations applied — so the migration SQL itself stays under test.
// Infrastructure tests run against PostgreSQL itself (row-level security, constraints,
// triggers): a stub would prove nothing. Adapted from build-track (test-database.ts).
//
// One container per Jest worker, one database per spec file: booting a container per spec
// made build-track's suite time out at random on a busy machine. The migrations run once per
// container, into a template database that every spec file copies (CREATE DATABASE … TEMPLATE):
// running the Prisma command line once per file made the whole suite exceed its time limits.

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

// The major version the compose runs.
const POSTGRES_IMAGE = 'postgres:16';
const APP_ROLE = 'yaar_app';
const APP_ROLE_PASSWORD = 'test-only';
// The owner of the tables, created like infra/postgres/init-roles.sh creates it.
const OWNER_ROLE = 'yaar';
const OWNER_ROLE_PASSWORD = 'test-only-owner';
const WITHOUT_PRIVILEGES = 'NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION';

const prismaConfig = resolve(__dirname, '../../prisma.config.ts');
const clientFor = (url: string): PrismaClient => new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
// The CLI installed in node_modules, not `npx`: no package lookup, no network.
const prismaCli = createRequire(__filename).resolve('prisma/build/index.js');

/** The worker's container, started once and reused; the run removes it when it ends. */
let container: Promise<StartedPostgreSqlContainer> | null = null;
const TEMPLATE = 'yaar_template';
let created = 0;

async function onCluster<T>(clusterUrl: string, work: (cluster: PrismaClient) => Promise<T>): Promise<T> {
  const cluster = clientFor(clusterUrl);
  try {
    return await work(cluster);
  } finally {
    await cluster.$disconnect();
  }
}

// Set by the global setup of Jest (apps/api/jest.test-containers.js), which removes these
// containers at the end of the run, or at the next run if this one is killed.
function labelsOfThisRun(): Record<string, string> {
  const run = process.env['YAAR_TEST_RUN'];
  const pid = process.env['YAAR_TEST_RUN_PID'];
  if (run === undefined || pid === undefined) {
    throw new Error('The test run has no label: run the API tests through apps/api/jest.config.js.');
  }
  return { 'yaar.test-run': run, 'yaar.test-run-pid': pid };
}

function startContainer(): Promise<StartedPostgreSqlContainer> {
  container ??= new PostgreSqlContainer(POSTGRES_IMAGE)
    .withLabels(labelsOfThisRun())
    // The superuser of a PostgreSQL can run programs: its password is drawn for the run, even
    // though the port is only published for the time of the tests.
    .withPassword(randomBytes(24).toString('hex'))
    .start()
    .then(async (started) => {
      // Roles are shared by every database of the cluster: they are created once, here, as the
      // database server is initialised in the stack (infra/postgres/init-roles.sh).
      await onCluster(started.getConnectionUri(), async (cluster) => {
        await cluster.$executeRawUnsafe(`CREATE ROLE ${OWNER_ROLE} LOGIN PASSWORD '${OWNER_ROLE_PASSWORD}' ${WITHOUT_PRIVILEGES}`);
        await cluster.$executeRawUnsafe(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE_PASSWORD}' ${WITHOUT_PRIVILEGES}`);
        await cluster.$executeRawUnsafe(`CREATE DATABASE "${TEMPLATE}" OWNER ${OWNER_ROLE}`);
      });
      // Migrated as the owner, never as the superuser: the tables belong to the owner.
      migrate(asRole(started.getConnectionUri(), TEMPLATE, OWNER_ROLE, OWNER_ROLE_PASSWORD));
      return started;
    });
  return container;
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

export async function createTestDatabase(options: { migrated?: boolean } = {}): Promise<TestDatabase> {
  const clusterUrl = (await startContainer()).getConnectionUri();
  // Unique per Jest worker (a process) and per spec file (a counter).
  const name = `yaar_test_${process.pid}_${++created}`;
  // A copy of the migrated template, or an empty database when the test applies migrations itself.
  await onCluster(clusterUrl, (cluster) =>
    cluster.$executeRawUnsafe(
      options.migrated === false ? `CREATE DATABASE "${name}" OWNER ${OWNER_ROLE}` : `CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE}" OWNER ${OWNER_ROLE}`,
    ),
  );

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
