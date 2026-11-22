// Starts an isolated server for browser tests: fresh data directory, offline seed data,
// real map tiles (if installed). Never touches the real data/ directory.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../server/config.ts';

const dir = path.join(ROOT_DIR, 'test-results', 'e2e-data');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
process.env.LI_DATA_DIR = dir;
process.env.LI_PORT = process.env.LI_PORT ?? '5199';
process.env.LI_HOST = '127.0.0.1';
process.env.LI_OFFLINE = 'true';
process.env.LI_TILES_DIR = process.env.LI_TILES_DIR ?? path.join(ROOT_DIR, 'data', 'sources', 'gtadb', 'maps', 'tiles', '6');
await import('../server/main.ts');
