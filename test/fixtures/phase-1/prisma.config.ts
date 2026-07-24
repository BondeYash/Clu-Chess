import { defineConfig } from 'prisma/config';

export default defineConfig({
  datasource: {
    url:
      process.env.MIGRATION_DATABASE_URL ??
      'postgresql://fixture:fixture@localhost:5432/fixture',
  },
  migrations: {
    path: 'prisma/migrations',
  },
  schema: 'prisma/schema.prisma',
});
