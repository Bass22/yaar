import tseslint from 'typescript-eslint';

// ── Dependency boundaries (CLAUDE.md §3), proven by tools/boundaries.spec.mjs ──────────────
// Flat config does not merge rule options: when several blocks match a file, the last one
// wins. Each zone therefore lists every restriction that applies to its files.

const crossProject = {
  regex: '^\\.\\./(.*/)?src(/|$)',
  message: 'A relative import must stay inside its project: use a workspace alias (tsconfig.base.json).',
};

const financeAlias = {
  regex: '^@domain/finance(/|$)',
  message: 'Need-to-know: only admin routes import domain/finance.',
};

const financeFolder = {
  regex: '(^|/)finance(/|$)',
  message: 'domain/journal ships to the caretaker phone: it never imports domain/finance.',
};

const adminCode = {
  regex: '(^|/)admin(/|$)',
  message: 'Admin code is only reached through a lazy route (dynamic import in the route table).',
};

// Fail-closed: everything is refused except relative imports and the listed modules.
const onlyOwnFilesAnd = (allowed) => ({
  regex: `^(?!\\.{1,2}(/|$)${allowed.map((name) => `|${name}$`).join('')})`,
  message:
    allowed.length === 0
      ? 'This package imports nothing but its own files.'
      : `This package imports only its own files and: ${allowed.join(', ')}.`,
});

const noDynamicImport = {
  selector: 'ImportExpression',
  message: 'Pure packages load nothing lazily.',
};

const noLazyFinance = {
  selector: 'ImportExpression[source.value=/^@domain\\/finance/]',
  message: financeAlias.message,
};

const typesOnly = [
  {
    selector:
      'Program > :not(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, TSInterfaceDeclaration, TSTypeAliasDeclaration)',
    message: 'packages/shared holds types only: no executable code.',
  },
  {
    selector: 'ExportNamedDeclaration > :not(TSInterfaceDeclaration, TSTypeAliasDeclaration, ExportSpecifier, Literal)',
    message: 'packages/shared holds types only: export interfaces and type aliases.',
  },
];

const restrictImports = (...patterns) => ({
  '@typescript-eslint/no-restricted-imports': ['error', { patterns }],
});

// A pure package: shipped files import only what is allowed; spec files may also use Vitest.
const purePackage = ({ folder, allowed = [], alsoRefused = [], syntax = [] }) => [
  {
    files: [`${folder}/**/*.ts`],
    ignores: ['**/*.spec.ts'],
    rules: {
      ...restrictImports(crossProject, onlyOwnFilesAnd(allowed), ...alsoRefused),
      'no-restricted-syntax': ['error', noDynamicImport, ...syntax],
    },
  },
  {
    files: [`${folder}/**/*.spec.ts`],
    rules: restrictImports(crossProject, onlyOwnFilesAnd([...allowed, 'vitest']), ...alsoRefused),
  },
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/out-tsc/**', '**/node_modules/**', '.nx/**', '.angular/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
    rules: {
      // CLAUDE.md §8: no `any`; use `unknown` and narrow at the boundaries.
      '@typescript-eslint/no-explicit-any': 'error',
      ...restrictImports(crossProject),
    },
  },
  {
    // Caretaker routes and the code shared by both views: no finance, no static path to admin.
    files: ['apps/web/**/*.ts'],
    ignores: ['apps/web/src/app/admin/**'],
    rules: {
      ...restrictImports(crossProject, financeAlias, adminCode),
      'no-restricted-syntax': ['error', noLazyFinance],
    },
  },
  ...purePackage({ folder: 'packages/kit' }),
  ...purePackage({ folder: 'packages/shared', syntax: typesOnly }),
  ...purePackage({ folder: 'packages/domain', allowed: ['@kit'] }),
  ...purePackage({ folder: 'packages/domain/src/journal', allowed: ['@kit'], alsoRefused: [financeFolder] }),
);
