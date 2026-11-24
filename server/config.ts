import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
// The Windows installer keeps settings next to the user's data (LI_DATA_DIR/.env), because the
// program folder is replaced on every upgrade. That file wins over a .env in the project folder.
if (process.env.LI_DATA_DIR) loadDotEnv(path.join(path.resolve(ROOT_DIR, process.env.LI_DATA_DIR), '.env'));
loadDotEnv(path.join(ROOT_DIR, '.env'));

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  seedDir: string;
  webDir: string;
  tilesDir: string;
  accessPin: string | null;
  allowPublicIps: boolean;
  updateIntervalHours: number;
  offline: boolean;
  schedulerEnabled: boolean;
  userBackupKeep: number;
  logLevel: string;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = process.env;
  const dataDir = path.resolve(ROOT_DIR, env.LI_DATA_DIR ?? 'data');
  const cfg: AppConfig = {
    host: env.LI_HOST ?? '0.0.0.0',
    port: Number(env.LI_PORT ?? 5180),
    dataDir,
    seedDir: path.join(ROOT_DIR, 'seed'),
    webDir: path.join(ROOT_DIR, 'dist'),
    tilesDir: path.resolve(ROOT_DIR, env.LI_TILES_DIR ?? path.join(dataDir, 'sources', 'gtadb', 'maps', 'tiles', '6')),
    accessPin: env.LI_ACCESS_PIN ? String(env.LI_ACCESS_PIN) : null,
    allowPublicIps: env.LI_ALLOW_PUBLIC_IPS === 'true',
    updateIntervalHours: Number(env.LI_UPDATE_INTERVAL_HOURS ?? 12),
    offline: env.LI_OFFLINE === 'true',
    schedulerEnabled: env.LI_SCHEDULER !== 'off',
    userBackupKeep: Number(env.LI_BACKUP_KEEP ?? 30),
    logLevel: env.LI_LOG_LEVEL ?? 'info',
    ...overrides,
  };
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  return cfg;
}
