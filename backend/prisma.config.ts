import { defineConfig } from 'prisma/config';

export default defineConfig({
  datasource: {
    url:
      process.env.MIGRATION_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgresql://cluchess_migrator:cluchess_migrator_dev@localhost:5432/cluchess?schema=public',
  },
  migrations: {
    path: 'prisma/migrations',
  },
  schema: 'prisma/schema.prisma',
});
