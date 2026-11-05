import tseslint from 'typescript-eslint';

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
    },
  },
);
