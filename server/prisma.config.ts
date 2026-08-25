import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 moved the datasource URL out of schema.prisma into this file.
// The CLI (db pull / generate) uses the DIRECT connection: introspection and
// migrations must not go through PgBouncer.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DIRECT_URL'),
  },
});
