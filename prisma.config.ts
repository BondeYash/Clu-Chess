import { defineConfig } from 'prisma/config';

export default defineConfig({
  datasource: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://cluchess:cluchess_dev@localhost:5432/cluchess?schema=public',
  },
  migrations: {
    path: 'prisma/migrations',
  },
  schema: 'prisma/schema.prisma',
});
