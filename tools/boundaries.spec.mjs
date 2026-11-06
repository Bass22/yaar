import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd: root });

const BOUNDARY_RULES = new Set(['@typescript-eslint/no-restricted-imports', 'no-restricted-syntax']);

// Lints source text as if it lived at `path`; the file does not need to exist.
async function boundaryErrors(path, source) {
  const [result] = await eslint.lintText(source, { filePath: join(root, path) });
  const fatal = result.messages.filter((message) => message.fatal);
  assert.deepEqual(fatal, [], `le fichier d'essai ${path} ne s'analyse pas`);
  return result.messages.filter((message) => BOUNDARY_RULES.has(message.ruleId));
}

async function assertRefused(path, source) {
  const errors = await boundaryErrors(path, source);
  assert.ok(errors.length >= 1, `devrait être refusé dans ${path} :\n${source}`);
}

async function assertAccepted(path, source) {
  const errors = await boundaryErrors(path, source);
  assert.deepEqual(
    errors.map((error) => error.message),
    [],
    `devrait être accepté dans ${path} :\n${source}`,
  );
}

// Spec: CLAUDE.md §3 — règle de dépendance ; backlog A.2
describe('Frontières de dépendance', () => {
  describe('packages/domain', () => {
    const file = 'packages/domain/src/journal/declaration.ts';

    it("le domaine n'importe ni NestJS, ni Prisma, ni Angular, ni une API de Node", async () => {
      const outsiders = ['@nestjs/common', '@prisma/client', '@angular/core', 'node:fs', 'fs', 'rxjs'];

      for (const outsider of outsiders) {
        await assertRefused(file, `import { anything } from '${outsider}';\nexport const used = anything;\n`);
      }
    });

    it('le domaine importe le kit et ses propres fichiers', async () => {
      await assertAccepted(file, `import { ok } from '@kit';\nimport { rule } from './rule';\nexport const used = [ok, rule];\n`);
    });

    it('le domaine ne charge rien en différé', async () => {
      await assertRefused(file, `export const lazy = () => import('./rule');\n`);
    });

    it('seuls les tests du domaine importent Vitest', async () => {
      const source = `import { it } from 'vitest';\nexport const used = it;\n`;

      await assertAccepted('packages/domain/src/journal/declaration.spec.ts', source);
      await assertRefused(file, source);
    });

    it("le journal n'importe jamais la finance, ni par l'alias ni par un chemin relatif", async () => {
      const imports = ['@domain/finance', '../finance/debt', '../finance'];

      for (const forbidden of imports) {
        await assertRefused(file, `import { debt } from '${forbidden}';\nexport const used = debt;\n`);
        await assertRefused(file, `import type { Debt } from '${forbidden}';\nexport type Used = Debt;\n`);
      }
    });

    it('la finance peut importer le journal', async () => {
      await assertAccepted(
        'packages/domain/src/finance/billable.ts',
        `import { variance } from '../journal/variance';\nexport const used = variance;\n`,
      );
    });
  });

  describe('apps/web', () => {
    const caretaker = 'apps/web/src/app/caretaker/gestures/death/death.ts';
    const admin = 'apps/web/src/app/admin/ledger/ledger.ts';

    it('une route gardien qui importe domain/finance est refusée', async () => {
      await assertRefused(caretaker, `import { debt } from '@domain/finance';\nexport const used = debt;\n`);
      await assertRefused(caretaker, `import type { Debt } from '@domain/finance';\nexport type Used = Debt;\n`);
      await assertRefused(caretaker, `export const lazy = () => import('@domain/finance');\n`);
    });

    it('une route gardien importe domain/journal et le kit', async () => {
      await assertAccepted(
        caretaker,
        `import { liveCount } from '@domain/journal';\nimport { ok } from '@kit';\nexport const used = [liveCount, ok];\n`,
      );
    });

    it('une route admin importe domain/finance', async () => {
      await assertAccepted(admin, `import { debt } from '@domain/finance';\nexport const used = debt;\n`);
    });

    it("le code web commun aux deux vues n'importe pas domain/finance", async () => {
      await assertRefused(
        'apps/web/src/app/core/format.ts',
        `import { debt } from '@domain/finance';\nexport const used = debt;\n`,
      );
    });

    it("hors des routes admin, rien n'importe le code admin en statique", async () => {
      await assertRefused(caretaker, `import { Ledger } from '../../../admin/ledger/ledger';\nexport const used = Ledger;\n`);
      await assertRefused(
        'apps/web/src/app/core/shell.ts',
        `import { Ledger } from '../admin/ledger/ledger';\nexport const used = Ledger;\n`,
      );
    });

    it('la table des routes charge la vue admin en paresseux', async () => {
      await assertAccepted(
        'apps/web/src/app/app.routes.ts',
        `export const routes = [{ path: 'admin', loadChildren: () => import('./admin/admin.routes') }];\n`,
      );
    });
  });

  describe('packages/contracts', () => {
    const file = 'packages/contracts/src/journal-event.dto.ts';

    it("contracts n'importe ni paquet ni autre projet du workspace", async () => {
      for (const outsider of ['@kit', '@domain/journal', 'rxjs', '@nestjs/common']) {
        await assertRefused(file, `import type { Anything } from '${outsider}';\nexport type Used = Anything;\n`);
      }
    });

    it('contracts ne contient que des types', async () => {
      const executable = [
        `export const MAX_BATCH = 50;\n`,
        `export function parse(): void {}\n`,
        `export class EventDto {}\n`,
        `export enum Role { Admin }\n`,
        `const hidden = 1;\nexport type Hidden = typeof hidden;\n`,
        `export default {};\n`,
      ];

      for (const source of executable) {
        await assertRefused(file, source);
      }
    });

    it('contracts accepte interfaces, alias de types et réexports', async () => {
      await assertAccepted(
        file,
        [
          `import type { Role } from './role';`,
          `export type { Role } from './role';`,
          `export * from './site.dto';`,
          `export interface EventDto { readonly id: string; readonly role: Role }`,
          `export type EventKind = 'death' | 'bag-opened';`,
          `interface Internal { readonly kind: EventKind }`,
          `export type Wrapped = Internal;`,
          ``,
        ].join('\n'),
      );
    });
  });

  describe('packages/kit', () => {
    const file = 'packages/kit/src/money.ts';

    it("le kit n'importe rien du reste du workspace, ni aucun paquet", async () => {
      for (const outsider of ['@domain/journal', '@domain/finance', 'rxjs', 'node:crypto', '../../domain/src/journal']) {
        await assertRefused(file, `import { anything } from '${outsider}';\nexport const used = anything;\n`);
      }
    });

    it('le kit importe ses propres fichiers, et Vitest dans ses tests', async () => {
      await assertAccepted(file, `import { ok } from './result';\nexport const used = ok;\n`);
      await assertAccepted('packages/kit/src/money.spec.ts', `import { it } from 'vitest';\nexport const used = it;\n`);
    });
  });

  describe('entre projets', () => {
    it("un import relatif ne sort pas de son projet : il passe par un alias", async () => {
      await assertRefused(
        'apps/api/src/journal/ingest.ts',
        `import { validate } from '../../../../packages/domain/src/journal/validate';\nexport const used = validate;\n`,
      );
      await assertRefused(
        'apps/web/src/app/admin/ledger/ledger.ts',
        `import { AppModule } from '../../../../../api/src/app.module';\nexport const used = AppModule;\n`,
      );
    });

    it('un import relatif reste libre à l’intérieur du projet', async () => {
      await assertAccepted(
        'apps/api/src/journal/ingest.ts',
        `import { JournalModule } from '../journal/journal.module';\nexport const used = JournalModule;\n`,
      );
    });
  });
});
