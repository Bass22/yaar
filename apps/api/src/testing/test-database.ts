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
// made build-track's suite time out at random on a busy machine.

export type TestDatabase = {
  /** Connection string of the owner of the database, the role that ran the migrations. */
  readonly url: string;
  readonly owner: PrismaClient;
  /** The same database, reached as the role the API runs under: bound by row-level security. */
  readonly appUrl: string;
  drop(): Promise<void>;
};

// The major version the compose runs.
const POSTGRES_IMAGE = 'postgres:16';
const APP_ROLE = 'yaar_app';
const APP_ROLE_PASSWORD = 'test-only';

const prismaConfig = resolve(__dirname, '../../prisma.config.ts');
const clientFor = (url: string): PrismaClient => new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
// The CLI installed in node_modules, not `npx`: no package lookup, no network.
const prismaCli = createRequire(__filename).resolve('prisma/build/index.js');

/** The worker's container, started once and reused; Testcontainers removes it when the process exits. */
let container: Promise<StartedPostgreSqlContainer> | null = null;
let created = 0;

async function onCluster<T>(clusterUrl: string, work: (cluster: PrismaClient) => Promise<T>): Promise<T> {
  const cluster = clientFor(clusterUrl);
  try {
    return await work(cluster);
  } finally {
    await cluster.$disconnect();
  }
}

function startContainer(): Promise<StartedPostgreSqlContainer> {
  container ??= new PostgreSqlContainer(POSTGRES_IMAGE)
    // The superuser of a PostgreSQL can run programs: its password is drawn for the run, even
    // though the port is only published for the time of the tests.
    .withPassword(randomBytes(24).toString('hex'))
    .start()
    .then(async (started) => {
      // The application role is shared by every database of the cluster: it gets its login
      // once, here, as the deployment gives it (infra/postgres/init-app-role.sh).
      await onCluster(started.getConnectionUri(), (cluster) =>
        cluster.$executeRawUnsafe(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE_PASSWORD}'`),
      );
      return started;
    });
  return container;
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
  await onCluster(clusterUrl, (cluster) => cluster.$executeRawUnsafe(`CREATE DATABASE "${name}"`));

  const target = new URL(clusterUrl);
  target.pathname = `/${name}`;
  const url = target.toString();
  if (options.migrated !== false) {
    migrate(url);
  }
  const asApp = new URL(url);
  asApp.username = APP_ROLE;
  asApp.password = APP_ROLE_PASSWORD;
  const owner = clientFor(url);

  return {
    url,
    owner,
    appUrl: asApp.toString(),
    async drop() {
      await owner.$disconnect();
      await onCluster(clusterUrl, (cluster) => cluster.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    },
  };
}
