import * as path from 'path';
import * as fs from 'fs';

// Load test env vars before any NestJS module is imported
const envFile = path.join(__dirname, '.env.test');
const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  process.env[key] = val;
}
