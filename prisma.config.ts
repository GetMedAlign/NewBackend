import * as path from 'path';
import * as dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

// For local development, prefer .env.local over the generated .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
// Fallback to plain .env (production / CI)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
