import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createTestDatabase, type TestDatabase } from './test-database';

// Spec: CLAUDE.md §7 — les tests de l'API tournent sur un PostgreSQL jetable ; un lancement
// enlève ses conteneurs, et balaie ceux d'un lancement tué en route.
jest.setTimeout(180_000);

type TestContainers = {
  RUN_LABEL: string;
  OWNER_LABEL: string;
  orphansAmong(lines: string[], alive: (pid: number) => boolean): string[];
};
const { RUN_LABEL, OWNER_LABEL, orphansAmong } = createRequire(__filename)('../../jest.test-containers.js') as TestContainers;

describe('Conteneurs des tests', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("le conteneur de ce processus porte l'étiquette du lancement en cours et le numéro du processus Jest qui l'enlèvera", async () => {
    const run = process.env['YAAR_TEST_RUN'] ?? '';
    const port = new URL(db.url).port;

    const listed = execFileSync('docker', ['ps', '--filter', `label=${RUN_LABEL}=${run}`, '--format', `{{.Ports}} {{.Label "${OWNER_LABEL}"}}`], { encoding: 'utf8' });

    expect(run).toMatch(/^[0-9a-f-]{36}$/);
    const mine = listed.split('\n').filter((line) => line.includes(`:${port}->5432`));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.endsWith(` ${process.env['YAAR_TEST_RUN_PID']}`)).toBe(true);
  });

  it("au lancement suivant, un conteneur dont le lancement n'existe plus est balayé ; celui d'un lancement vivant est gardé ; une étiquette illisible est balayée", () => {
    const alive = (pid: number) => pid === 4242;

    expect(orphansAmong(['aaa111 4242', 'bbb222 9999', 'ccc333 ', 'ddd444 abc', 'eee555 -1', ''], alive)).toEqual(['bbb222', 'ccc333', 'ddd444', 'eee555']);
  });
});
