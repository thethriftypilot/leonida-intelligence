// Command-line backup of personal progress (safe to run while the server is running).
// Usage: node scripts/backup.ts [destination-folder]
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../server/config.ts';
import { vacuumInto } from '../server/backup.ts';

const cfg = loadConfig();
const src = path.join(cfg.dataDir, 'user.sqlite');
if (!fs.existsSync(src)) {
  console.error(`No progress database at ${src}`);
  process.exit(1);
}
const destDir = path.resolve(process.argv[2] ?? path.join(cfg.dataDir, 'backups'));
const dest = path.join(destDir, `user-cli-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sqlite`);
const db = new DatabaseSync(src, { readOnly: true });
vacuumInto(db, dest);
db.close();
console.log(`Backup written: ${dest}`);
