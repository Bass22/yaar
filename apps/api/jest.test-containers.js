// The PostgreSQL of the API tests (src/testing/test-database.ts): one container for the whole
// run, started and migrated once here, before the workers. Each spec file copies the migrated
// template into a fresh database of its own.
//
// Why here and not in each worker: Jest loads modules anew for every spec file, so a container
// kept in a module variable was started again for each file — 44 PostgreSQL alive together,
// which saturated the machine until transactions and health checks timed out at random
// (stability slice, 2026-11-14).
//
// The container is labelled with its run and with the process id of that Jest run. The run
// removes it when it ends (globalTeardown); a run that never got to its end (killed,
// interrupted) is swept by the next run, once its process no longer exists.
const { execFileSync } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { resolve } = require('node:path');

const RUN_LABEL = 'yaar.test-run';
const OWNER_LABEL = 'yaar.test-run-pid';

// The major version the compose runs.
const POSTGRES_IMAGE = 'postgres:16';
// The roles are created like infra/postgres/init-roles.sh creates them: neither superuser nor
// BYPASSRLS. Test-only passwords, for a container that lives as long as the run.
const OWNER_ROLE = 'yaar';
const OWNER_ROLE_PASSWORD = 'test-only-owner';
const APP_ROLE = 'yaar_app';
const APP_ROLE_PASSWORD = 'test-only';
const WITHOUT_PRIVILEGES = 'NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION';
const TEMPLATE = 'yaar_template';
// Every spec file of every worker connects at once: more than PostgreSQL's 100 by default.
const MAX_CONNECTIONS = '400';

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function remove(ids) {
  if (ids.length > 0) {
    docker('rm', '--force', '--volumes', ...ids);
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists, but belongs to someone else.
    return error.code === 'EPERM';
  }
}

/** The containers whose Jest run is gone, from lines "<container id> <pid of the run>". */
function orphansAmong(lines, alive = isAlive) {
  return lines
    .map((line) => line.trim().split(/\s+/))
    .filter(([id, pid]) => id && !(Number.isInteger(Number(pid)) && Number(pid) > 0 && alive(Number(pid))))
    .map(([id]) => id);
}

function withRole(clusterUrl, database, role, password) {
  const url = new URL(clusterUrl);
  url.pathname = `/${database}`;
  url.username = role;
  url.password = password;
  return url.toString();
}

async function globalSetup() {
  const listed = docker('ps', '--all', '--filter', `label=${OWNER_LABEL}`, '--format', `{{.ID}} {{.Label "${OWNER_LABEL}"}}`);
  remove(orphansAmong(listed === '' ? [] : listed.split('\n')));
  // Read by the workers, which Jest starts after this function.
  process.env.YAAR_TEST_RUN = randomUUID();
  process.env.YAAR_TEST_RUN_PID = String(process.pid);

  const { PostgreSqlContainer } = require('@testcontainers/postgresql');
  const started = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withLabels({ [RUN_LABEL]: process.env.YAAR_TEST_RUN, [OWNER_LABEL]: process.env.YAAR_TEST_RUN_PID })
    // The superuser of a PostgreSQL can run programs: its password is drawn for the run, even
    // though the port is only published for the time of the tests.
    .withPassword(randomBytes(24).toString('hex'))
    .withCommand(['postgres', '-c', `max_connections=${MAX_CONNECTIONS}`])
    .start();
  const sql = async (statement) => {
    const result = await started.exec(['psql', '-v', 'ON_ERROR_STOP=1', '-U', started.getUsername(), '-d', started.getDatabase(), '-c', statement]);
    if (result.exitCode !== 0) throw new Error(`PostgreSQL of the tests: ${result.output}`);
  };
  // Roles are shared by every database of the cluster: created once, as the database server is
  // initialised in the stack (infra/postgres/init-roles.sh).
  await sql(`CREATE ROLE ${OWNER_ROLE} LOGIN PASSWORD '${OWNER_ROLE_PASSWORD}' ${WITHOUT_PRIVILEGES}`);
  await sql(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE_PASSWORD}' ${WITHOUT_PRIVILEGES}`);
  await sql(`CREATE DATABASE "${TEMPLATE}" OWNER ${OWNER_ROLE}`);
  // Migrated once, as the owner, never as the superuser: the tables belong to the owner. The
  // CLI installed in node_modules, not `npx`: no package lookup, no network.
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--config', resolve(__dirname, 'prisma.config.ts')], {
    env: { ...process.env, DATABASE_URL: withRole(started.getConnectionUri(), TEMPLATE, OWNER_ROLE, OWNER_ROLE_PASSWORD) },
    stdio: 'pipe',
  });
  process.env.YAAR_TEST_CLUSTER_URL = started.getConnectionUri();
}

function globalTeardown() {
  const run = process.env.YAAR_TEST_RUN;
  if (run !== undefined) {
    const listed = docker('ps', '--all', '--quiet', '--filter', `label=${RUN_LABEL}=${run}`);
    remove(listed === '' ? [] : listed.split('\n'));
  }
}

module.exports = { RUN_LABEL, OWNER_LABEL, OWNER_ROLE, OWNER_ROLE_PASSWORD, APP_ROLE, APP_ROLE_PASSWORD, TEMPLATE, globalSetup, globalTeardown, orphansAmong };
