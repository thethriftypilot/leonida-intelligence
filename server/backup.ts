// Backups:
//  - user backups: consistent SQLite copies of user.sqlite (VACUUM INTO) in data/backups/
//    taken daily, before schema migrations, and on demand; JSON export/import via the API.
//  - world snapshots: copies of world.sqlite in data/snapshots/ taken before every research
//    update so a bad update can be rolled back.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DB } from './db.ts';
import { sqlString, tx } from './db.ts';

export interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
  kind: 'user' | 'world';
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function list(dir: string, kind: BackupFile['kind']): BackupFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sqlite'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, createdAt: st.mtime.toISOString(), kind };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

function prune(dir: string, prefix: string, keep: number): void {
  const files = list(dir, 'user').filter((f) => f.name.startsWith(prefix));
  for (const f of files.slice(keep)) fs.rmSync(path.join(dir, f.name), { force: true });
}

export function vacuumInto(db: DB, file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO ${sqlString(file)}`);
}

export class BackupManager {
  dataDir: string;
  keep: number;
  constructor(dataDir: string, keep = 30) {
    this.dataDir = dataDir;
    this.keep = keep;
  }

  get userDir(): string { return path.join(this.dataDir, 'backups'); }
  get worldDir(): string { return path.join(this.dataDir, 'snapshots'); }

  backupUser(db: DB, reason: 'auto' | 'manual' | 'pre-migration' | 'pre-restore'): BackupFile {
    const name = `user-${reason}-${stamp()}.sqlite`;
    vacuumInto(db, path.join(this.userDir, name));
    prune(this.userDir, `user-${reason}-`, reason === 'manual' ? 100 : this.keep);
    return list(this.userDir, 'user').find((f) => f.name === name)!;
  }

  /** Raw file copy for use before the DB is opened by migrations. */
  backupUserFile(file: string, reason: string): void {
    if (!fs.existsSync(file)) return;
    fs.mkdirSync(this.userDir, { recursive: true });
    fs.copyFileSync(file, path.join(this.userDir, `user-${reason}-${stamp()}.sqlite`));
  }

  userBackups(): BackupFile[] { return list(this.userDir, 'user'); }

  lastAutoBackupAt(): number {
    const f = this.userBackups().find((b) => b.name.startsWith('user-auto-'));
    return f ? Date.parse(f.createdAt) : 0;
  }

  /** Restore user data from a stored backup file, table by table, inside a transaction. */
  restoreUser(db: DB, name: string): void {
    const file = this.resolve(this.userDir, name);
    const src = new DatabaseSync(file, { readOnly: true });
    try {
      const tables = (src.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
      const dstTables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name));
      this.backupUser(db, 'pre-restore');
      tx(db, () => {
        for (const t of dstTables) if (t !== 'checklist_items') db.exec(`DELETE FROM ${t}`);
        db.exec('DELETE FROM checklist_items');
        for (const t of tables) {
          if (!dstTables.has(t)) continue;
          const dstCols = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
          const rows = src.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
          for (const r of rows) {
            const cols = Object.keys(r).filter((c) => dstCols.has(c));
            db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => r[c] as string | number | null));
          }
        }
      });
    } finally {
      src.close();
    }
  }

  snapshotWorld(db: DB, label: string): BackupFile {
    const name = `world-${label}-${stamp()}.sqlite`;
    vacuumInto(db, path.join(this.worldDir, name));
    const files = list(this.worldDir, 'world');
    for (const f of files.slice(8)) fs.rmSync(path.join(this.worldDir, f.name), { force: true });
    return { ...list(this.worldDir, 'world').find((f) => f.name === name)!, kind: 'world' };
  }

  worldSnapshots(): BackupFile[] { return list(this.worldDir, 'world').map((f) => ({ ...f, kind: 'world' as const })); }

  /** Roll the research database back to a snapshot. User progress is unaffected (separate DB). */
  restoreWorld(db: DB, name: string): void {
    const file = this.resolve(this.worldDir, name);
    db.exec(`ATTACH DATABASE ${sqlString(file)} AS snap`);
    try {
      tx(db, () => {
        for (const t of ['locations', 'location_history', 'review_queue', 'update_runs', 'sources']) {
          db.exec(`DELETE FROM main.${t}`);
          db.exec(`INSERT INTO main.${t} SELECT * FROM snap.${t}`);
        }
      });
    } finally {
      db.exec('DETACH DATABASE snap');
    }
  }

  resolve(dir: string, name: string): string {
    if (!/^[\w.-]+\.sqlite$/.test(name)) throw new Error('invalid backup name');
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) throw new Error('backup not found');
    return file;
  }
}
