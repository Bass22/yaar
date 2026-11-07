// The PostgreSQL containers of the API tests (src/testing/test-database.ts) are removed by the
// run that started them, not left to Testcontainers' reaper alone: runs that were killed, or
// that outlived their time limits, left dozens of containers behind and slowed Docker down
// until the next suite timed out.
//
// Every container is labelled with its run and with the process id of that Jest run. The run
// removes its own containers when it ends (globalTeardown); a run that never got to its end
// (killed, interrupted) is swept by the next run, once its process no longer exists.
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const RUN_LABEL = 'yaar.test-run';
const OWNER_LABEL = 'yaar.test-run-pid';

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

function globalSetup() {
  const listed = docker('ps', '--all', '--filter', `label=${OWNER_LABEL}`, '--format', `{{.ID}} {{.Label "${OWNER_LABEL}"}}`);
  remove(orphansAmong(listed === '' ? [] : listed.split('\n')));
  // Read by the workers, which Jest starts after this function.
  process.env.YAAR_TEST_RUN = randomUUID();
  process.env.YAAR_TEST_RUN_PID = String(process.pid);
}

function globalTeardown() {
  const run = process.env.YAAR_TEST_RUN;
  if (run !== undefined) {
    const listed = docker('ps', '--all', '--quiet', '--filter', `label=${RUN_LABEL}=${run}`);
    remove(listed === '' ? [] : listed.split('\n'));
  }
}

module.exports = { RUN_LABEL, OWNER_LABEL, globalSetup, globalTeardown, orphansAmong };
