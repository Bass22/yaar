import { readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

// Production build of the API: `apps/api/dist/main.js` (the server) and
// `apps/api/dist/bootstrap-tenant.js` and `apps/api/dist/add-admin.js` (the provisioning scripts
// run by the operator).
// esbuild bundles the application code only, resolving the workspace aliases (`@kit`,
// `@domain/…`) at build time, so no resolver is needed at runtime. `packages: 'external'`
// leaves node_modules out of the bundle: NestJS and native modules load normally.
// Same strategy as build-track (backend/scripts/build.mjs).

const root = fileURLToPath(new URL('../..', import.meta.url));
const tsconfigPath = resolve(root, 'apps/api/tsconfig.app.json');
const outdir = resolve(root, 'apps/api/dist');

const { config } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
const { options } = ts.parseJsonConfigFileContent(config, ts.sys, dirname(tsconfigPath));

// esbuild does not emit decorator metadata, and NestJS injection depends on it: TypeScript
// transpiles each file (types are checked by the `typecheck` target), esbuild links them.
const transpileWithTypeScript = {
  name: 'transpile-with-typescript',
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
      const { outputText } = ts.transpileModule(await readFile(path, 'utf8'), {
        fileName: path,
        compilerOptions: {
          ...options,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          noEmit: false,
          sourceMap: false,
          inlineSourceMap: true,
          inlineSources: true,
        },
      });
      return { contents: outputText, loader: 'js' };
    });
  },
};

await rm(outdir, { recursive: true, force: true });
await build({
  absWorkingDir: root,
  entryPoints: { main: 'apps/api/src/main.ts', 'bootstrap-tenant': 'apps/api/src/bootstrap-tenant.ts', 'add-admin': 'apps/api/src/add-admin.ts' },
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  packages: 'external',
  tsconfig: tsconfigPath,
  plugins: [transpileWithTypeScript],
  logLevel: 'info',
});
