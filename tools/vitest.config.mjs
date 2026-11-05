import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('..', import.meta.url));
const { compilerOptions } = JSON.parse(readFileSync(resolve(root, 'tsconfig.base.json'), 'utf8'));

// Workspace aliases have one source of truth: `paths` in tsconfig.base.json.
export default defineConfig({
  resolve: {
    alias: Object.entries(compilerOptions.paths).map(([alias, [target]]) => ({
      find: new RegExp(`^${alias}$`),
      replacement: resolve(root, target),
    })),
  },
});
