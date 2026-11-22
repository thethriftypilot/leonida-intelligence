// Two SQLite databases keep shared research data and personal progress physically apart:
//   world.sqlite – locations, sources, review queue, update history (rebuilt/updated by research)
//   user.sqlite  – progress, notes, markers, checklists, routes, settings (never touched by research)

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type DB = DatabaseSync;

const WORLD_MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE sources (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, description TEXT, homepage TEXT,
    license TEXT, attribution TEXT, enabled INTEGER NOT NULL DEFAULT 1, config TEXT NOT NULL DEFAULT '{}',
    state TEXT NOT NULL DEFAULT '{}', last_run_at TEXT, last_success_at TEXT, last_status TEXT NOT NULL DEFAULT 'never',
    last_error TEXT, revision TEXT
  );
  CREATE TABLE locations (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL, source_key TEXT NOT NULL,
    name TEXT NOT NULL, grp TEXT NOT NULL, category TEXT NOT NULL, subcategory TEXT, tags TEXT NOT NULL DEFAULT '[]',
    description TEXT, steps TEXT NOT NULL DEFAULT '[]', x REAL, y REAL, coord_system TEXT NOT NULL DEFAULT 'gtadb-vi',
    precision TEXT NOT NULL, region TEXT, neighborhood TEXT, address TEXT, availability TEXT, chapter_min INTEGER,
    missable INTEGER NOT NULL DEFAULT 0, characters TEXT, rewards TEXT, repeatable INTEGER, enterable INTEGER NOT NULL DEFAULT 0,
    media TEXT NOT NULL DEFAULT '[]', source_url TEXT, source_label TEXT, links TEXT NOT NULL DEFAULT '[]', evidence TEXT,
    verification TEXT NOT NULL, confidence REAL NOT NULL, spoiler TEXT NOT NULL, related_id TEXT,
    first_seen TEXT NOT NULL, updated_at TEXT NOT NULL, discovered_at TEXT, source_time TEXT,
    version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active', merged_into TEXT, content_hash TEXT NOT NULL,
    UNIQUE (source_id, source_key)
  );
  CREATE INDEX idx_locations_grp ON locations(grp, category);
  CREATE INDEX idx_locations_status ON locations(status);
  CREATE INDEX idx_locations_discovered ON locations(discovered_at);
  CREATE TABLE location_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, location_id TEXT NOT NULL, run_id INTEGER, change TEXT NOT NULL,
    diff TEXT, at TEXT NOT NULL
  );
  CREATE INDEX idx_history_loc ON location_history(location_id);
  CREATE INDEX idx_history_run ON location_history(run_id);
  CREATE TABLE review_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, source_id TEXT NOT NULL, source_key TEXT NOT NULL,
    title TEXT NOT NULL, url TEXT, summary TEXT, suggested_group TEXT, payload TEXT NOT NULL DEFAULT 'null',
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, resolved_at TEXT, location_id TEXT,
    UNIQUE (kind, source_id, source_key)
  );
  CREATE TABLE update_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, trigger TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
    status TEXT NOT NULL, report TEXT NOT NULL DEFAULT '[]', summary TEXT NOT NULL DEFAULT ''
  );
  `,
];

const USER_MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE progress (
    location_id TEXT PRIMARY KEY, visited INTEGER NOT NULL DEFAULT 0, collected INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, planned INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, visited_at TEXT, completed_at TEXT
  );
  CREATE TABLE custom_markers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, icon TEXT NOT NULL DEFAULT 'pin',
    color TEXT NOT NULL DEFAULT '#ff5fa2', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE checklists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE checklist_items (
    id TEXT PRIMARY KEY, checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE, text TEXT NOT NULL,
    location_id TEXT, done INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE routes (id TEXT PRIMARY KEY, name TEXT NOT NULL, waypoints TEXT NOT NULL, start TEXT, created_at TEXT NOT NULL);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE verification_overrides (location_id TEXT PRIMARY KEY, verification TEXT NOT NULL, note TEXT, at TEXT NOT NULL);
  CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL, location_id TEXT, detail TEXT);
  CREATE INDEX idx_activity_at ON activity_log(at);
  `,
  // v2: user-supplied positions for unplaced research items (kept separate from sourced coordinates)
  `
  CREATE TABLE position_overrides (location_id TEXT PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL, note TEXT, at TEXT NOT NULL);
  `,
];

export const WORLD_SCHEMA_VERSION = WORLD_MIGRATIONS.length;
export const USER_SCHEMA_VERSION = USER_MIGRATIONS.length;

function userVersion(db: DB): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

export function migrate(db: DB, migrations: string[], onBeforeMigrate?: (from: number, to: number) => void): { from: number; to: number } {
  const from = userVersion(db);
  if (from > migrations.length) {
    throw new Error(`Database schema v${from} is newer than this application supports (v${migrations.length}). Update the application or restore a backup.`);
  }
  if (from < migrations.length && onBeforeMigrate) onBeforeMigrate(from, migrations.length);
  for (let v = from; v < migrations.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return { from, to: migrations.length };
}

function open(file: string): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

export interface Databases {
  world: DB;
  user: DB;
  worldFile: string;
  userFile: string;
  close(): void;
}

export function openDatabases(dataDir: string, beforeUserMigrate?: (file: string, from: number, to: number) => void): Databases {
  const worldFile = path.join(dataDir, 'world.sqlite');
  const userFile = path.join(dataDir, 'user.sqlite');
  const world = open(worldFile);
  migrate(world, WORLD_MIGRATIONS);
  const user = open(userFile);
  migrate(user, USER_MIGRATIONS, (from, to) => {
    if (from > 0 && beforeUserMigrate) beforeUserMigrate(userFile, from, to);
  });
  return {
    world, user, worldFile, userFile,
    close() {
      try { world.close(); } catch { /* already closed */ }
      try { user.close(); } catch { /* already closed */ }
    },
  };
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
