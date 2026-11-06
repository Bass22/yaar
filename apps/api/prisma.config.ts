import { defineConfig } from 'prisma/config';

// Read by the Prisma command line only (generate, migrate): the API itself never loads it.
// The address of the database comes from the environment; generating the client or computing
// a migration script needs none.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
