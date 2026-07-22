import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().url(),

  JWT_SECRET: z.string().min(32),

  JWT_EXPIRY_MINUTES: z.coerce.number().default(60),

  ENCRYPTION_KEY: z.string().refine((val) => Buffer.from(val, 'base64').length === 32, {
    message: 'ENCRYPTION_KEY must base64-decode to exactly 32 bytes',
  }),

  SENDGRID_API_KEY: z.string().min(1),

  SENDGRID_FROM_EMAIL: z.string().email(),

  APP_BASE_URL: z.string().url(),

  COOKIE_DOMAIN: z.string().optional(),

  CLAIM_TOKEN_SECRET: z.string().min(32),

  SUPABASE_URL: z.string().url(),

  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  SUPABASE_STORAGE_BUCKET: z.string().default('clinic-media'),

  STRIPE_SECRET_KEY: z.string().min(1),

  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  JOB_TRIGGER_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, unknown>): Env {
  return envSchema.parse(raw);
}
