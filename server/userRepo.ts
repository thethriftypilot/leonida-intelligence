import crypto from 'node:crypto';
import type { DB } from './db.ts';
import { nowIso, tx } from './db.ts';
import type {
  Checklist, ChecklistItem, CustomMarker, Progress, ProgressFlag, SavedRoute, SpoilerSettings, Verification,
} from '../shared/types.ts';
import { DEFAULT_SPOILERS, PROGRESS_FLAGS, VERIFICATIONS } from '../shared/types.ts';

type Row = Record<string, unknown>;

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function rowToProgress(r: Row): Progress {
  return {
    locationId: r.location_id as string,
    visited: !!r.visited, collected: !!r.collected, completed: !!r.completed, favorite: !!r.favorite, planned: !!r.planned,
    notes: r.notes as string, updatedAt: r.updated_at as string,
    visitedAt: (r.visited_at as string) ?? null, completedAt: (r.completed_at as string) ?? null,
  };
}

export interface AppSettings {
  spoilers: SpoilerSettings;
  updateIntervalHours: number;
  myPosition: { x: number; y: number } | null;
}

export class UserRepo {
  db: DB;
  constructor(db: DB) {
    this.db = db;
  }

  // ---------------------------------------------------------------- progress
  allProgress(): Record<string, Progress> {
    const out: Record<string, Progress> = {};
    for (const r of this.db.prepare('SELECT * FROM progress').all() as Row[]) out[r.location_id as string] = rowToProgress(r);
    return out;
  }

  getProgress(id: string): Progress | null {
    const r = this.db.prepare('SELECT * FROM progress WHERE location_id=?').get(id) as Row | undefined;
    return r ? rowToProgress(r) : null;
  }

  setProgress(id: string, patch: Partial<Record<ProgressFlag, boolean>> & { notes?: string }): Progress {
    const now = nowIso();
    const cur = this.getProgress(id) ?? {
      locationId: id, visited: false, collected: false, completed: false, favorite: false, planned: false,
      notes: '', updatedAt: now, visitedAt: null, completedAt: null,
    };
    const next: Progress = { ...cur, updatedAt: now };
    for (const f of PROGRESS_FLAGS) if (typeof patch[f] === 'boolean') next[f] = patch[f]!;
    if (typeof patch.notes === 'string') next.notes = patch.notes.slice(0, 20000);
    if (next.visited && !cur.visited) next.visitedAt = now;
    if (!next.visited) next.visitedAt = null;
    const doneNow = next.completed || next.collected;
    const doneBefore = cur.completed || cur.collected;
    if (doneNow && !doneBefore) next.completedAt = now;
    if (!doneNow) next.completedAt = null;
    this.db.prepare(`
      INSERT INTO progress (location_id, visited, collected, completed, favorite, planned, notes, updated_at, visited_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(location_id) DO UPDATE SET visited=excluded.visited, collected=excluded.collected, completed=excluded.completed,
        favorite=excluded.favorite, planned=excluded.planned, notes=excluded.notes, updated_at=excluded.updated_at,
        visited_at=excluded.visited_at, completed_at=excluded.completed_at
    `).run(id, +next.visited, +next.collected, +next.completed, +next.favorite, +next.planned, next.notes, now, next.visitedAt, next.completedAt);
    const changed = PROGRESS_FLAGS.filter((f) => cur[f] !== next[f]).map((f) => `${f}=${next[f]}`);
    if (changed.length || patch.notes !== undefined) this.log('progress', id, changed.join(',') || 'notes');
    return next;
  }

  /** Move progress from a merged/duplicate record onto its canonical record without losing anything. */
  migrateProgress(fromId: string, toId: string): void {
    const a = this.getProgress(fromId);
    if (!a) return;
    const b = this.getProgress(toId);
    const patch: Partial<Record<ProgressFlag, boolean>> & { notes?: string } = {};
    for (const f of PROGRESS_FLAGS) patch[f] = a[f] || (b?.[f] ?? false);
    patch.notes = [b?.notes, a.notes].filter(Boolean).join('\n\n');
    this.setProgress(toId, patch);
    this.log('merge', toId, `progress merged from ${fromId}`);
  }

  recentlyCompleted(limit = 30): Progress[] {
    return (this.db.prepare('SELECT * FROM progress WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT ?').all(limit) as Row[]).map(rowToProgress);
  }

  recentlyVisited(limit = 30): Progress[] {
    return (this.db.prepare('SELECT * FROM progress WHERE visited_at IS NOT NULL ORDER BY visited_at DESC LIMIT ?').all(limit) as Row[]).map(rowToProgress);
  }

  log(action: string, locationId: string | null, detail: string): void {
    this.db.prepare('INSERT INTO activity_log (at, action, location_id, detail) VALUES (?, ?, ?, ?)').run(nowIso(), action, locationId, detail);
  }

  // ---------------------------------------------------------------- verification & position overrides
  verificationOverrides(): Record<string, { verification: Verification; note: string | null; at: string }> {
    const out: Record<string, { verification: Verification; note: string | null; at: string }> = {};
    for (const r of this.db.prepare('SELECT * FROM verification_overrides').all() as Row[]) {
      out[r.location_id as string] = { verification: r.verification as Verification, note: (r.note as string) ?? null, at: r.at as string };
    }
    return out;
  }

  setVerificationOverride(id: string, v: Verification | null, note: string | null): void {
    if (v === null) {
      this.db.prepare('DELETE FROM verification_overrides WHERE location_id=?').run(id);
      return;
    }
    if (!VERIFICATIONS.includes(v)) throw new Error('invalid verification');
    this.db.prepare(`INSERT INTO verification_overrides (location_id, verification, note, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(location_id) DO UPDATE SET verification=excluded.verification, note=excluded.note, at=excluded.at`).run(id, v, note, nowIso());
    this.log('verification', id, v);
  }

  positionOverrides(): Record<string, { x: number; y: number; note: string | null; at: string }> {
    const out: Record<string, { x: number; y: number; note: string | null; at: string }> = {};
    for (const r of this.db.prepare('SELECT * FROM position_overrides').all() as Row[]) {
      out[r.location_id as string] = { x: r.x as number, y: r.y as number, note: (r.note as string) ?? null, at: r.at as string };
    }
    return out;
  }

  setPositionOverride(id: string, pos: { x: number; y: number } | null, note: string | null): void {
    if (!pos) {
      this.db.prepare('DELETE FROM position_overrides WHERE location_id=?').run(id);
      return;
    }
    this.db.prepare(`INSERT INTO position_overrides (location_id, x, y, note, at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(location_id) DO UPDATE SET x=excluded.x, y=excluded.y, note=excluded.note, at=excluded.at`).run(id, pos.x, pos.y, note, nowIso());
  }

  // ---------------------------------------------------------------- markers
  markers(): CustomMarker[] {
    return (this.db.prepare('SELECT * FROM custom_markers ORDER BY created_at').all() as Row[]).map((r) => ({
      id: r.id as string, name: r.name as string, x: r.x as number, y: r.y as number, icon: r.icon as string,
      color: r.color as string, notes: r.notes as string, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }));
  }

  upsertMarker(m: Partial<CustomMarker> & { x: number; y: number; name: string }): CustomMarker {
    const now = nowIso();
    const id = m.id ?? newId('mk');
    this.db.prepare(`INSERT INTO custom_markers (id, name, x, y, icon, color, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, x=excluded.x, y=excluded.y, icon=excluded.icon, color=excluded.color,
      notes=excluded.notes, updated_at=excluded.updated_at`).run(
      id, m.name.slice(0, 200), m.x, m.y, m.icon ?? 'pin', m.color ?? '#ff5fa2', (m.notes ?? '').slice(0, 20000), m.createdAt ?? now, now);
    return this.markers().find((x) => x.id === id)!;
  }

  deleteMarker(id: string): boolean {
    return this.db.prepare('DELETE FROM custom_markers WHERE id=?').run(id).changes > 0;
  }

  // ---------------------------------------------------------------- checklists
  checklists(): Checklist[] {
    const items = (this.db.prepare('SELECT * FROM checklist_items ORDER BY sort, rowid').all() as Row[]).map((r): ChecklistItem => ({
      id: r.id as string, checklistId: r.checklist_id as string, text: r.text as string,
      locationId: (r.location_id as string) ?? null, done: !!r.done, sort: r.sort as number,
    }));
    return (this.db.prepare('SELECT * FROM checklists ORDER BY created_at').all() as Row[]).map((r) => ({
      id: r.id as string, name: r.name as string, createdAt: r.created_at as string,
      items: items.filter((i) => i.checklistId === r.id),
    }));
  }

  createChecklist(name: string): Checklist {
    const id = newId('cl');
    this.db.prepare('INSERT INTO checklists (id, name, created_at) VALUES (?, ?, ?)').run(id, name.slice(0, 200), nowIso());
    return this.checklists().find((c) => c.id === id)!;
  }

  renameChecklist(id: string, name: string): void {
    this.db.prepare('UPDATE checklists SET name=? WHERE id=?').run(name.slice(0, 200), id);
  }

  deleteChecklist(id: string): boolean {
    return this.db.prepare('DELETE FROM checklists WHERE id=?').run(id).changes > 0;
  }

  addChecklistItem(checklistId: string, text: string, locationId: string | null): ChecklistItem {
    const id = newId('ci');
    const sort = ((this.db.prepare('SELECT COALESCE(MAX(sort),0)+1 s FROM checklist_items WHERE checklist_id=?').get(checklistId) as Row).s as number);
    this.db.prepare('INSERT INTO checklist_items (id, checklist_id, text, location_id, done, sort) VALUES (?, ?, ?, ?, 0, ?)').run(id, checklistId, text.slice(0, 500), locationId, sort);
    return { id, checklistId, text, locationId, done: false, sort };
  }

  updateChecklistItem(id: string, patch: { text?: string; done?: boolean }): void {
    if (typeof patch.text === 'string') this.db.prepare('UPDATE checklist_items SET text=? WHERE id=?').run(patch.text.slice(0, 500), id);
    if (typeof patch.done === 'boolean') this.db.prepare('UPDATE checklist_items SET done=? WHERE id=?').run(+patch.done, id);
  }

  deleteChecklistItem(id: string): boolean {
    return this.db.prepare('DELETE FROM checklist_items WHERE id=?').run(id).changes > 0;
  }

  // ---------------------------------------------------------------- routes
  routes(): SavedRoute[] {
    return (this.db.prepare('SELECT * FROM routes ORDER BY created_at DESC').all() as Row[]).map((r) => ({
      id: r.id as string, name: r.name as string, waypoints: JSON.parse(r.waypoints as string),
      start: r.start ? JSON.parse(r.start as string) : null, createdAt: r.created_at as string,
    }));
  }

  saveRoute(r: { id?: string; name: string; waypoints: string[]; start: { x: number; y: number } | null }): SavedRoute {
    const id = r.id ?? newId('rt');
    this.db.prepare(`INSERT INTO routes (id, name, waypoints, start, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, waypoints=excluded.waypoints, start=excluded.start`).run(
      id, r.name.slice(0, 200), JSON.stringify(r.waypoints.slice(0, 200)), r.start ? JSON.stringify(r.start) : null, nowIso());
    return this.routes().find((x) => x.id === id)!;
  }

  deleteRoute(id: string): boolean {
    return this.db.prepare('DELETE FROM routes WHERE id=?').run(id).changes > 0;
  }

  // ---------------------------------------------------------------- settings
  getSetting<T>(key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as Row | undefined;
    if (!r) return fallback;
    try { return JSON.parse(r.value as string) as T; } catch { return fallback; }
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }

  settings(defaultInterval: number): AppSettings {
    const sp = this.getSetting<Partial<SpoilerSettings>>('spoilers', {});
    return {
      spoilers: { ...DEFAULT_SPOILERS, ...sp, revealUntil: 0 },
      updateIntervalHours: this.getSetting('updateIntervalHours', defaultInterval),
      myPosition: this.getSetting<{ x: number; y: number } | null>('myPosition', null),
    };
  }

  // ---------------------------------------------------------------- export / import
  exportAll(): UserExport {
    const t = (sql: string) => this.db.prepare(sql).all();
    return {
      format: 'leonida-intelligence-user-backup',
      version: 1,
      exportedAt: nowIso(),
      tables: {
        progress: t('SELECT * FROM progress'),
        custom_markers: t('SELECT * FROM custom_markers'),
        checklists: t('SELECT * FROM checklists'),
        checklist_items: t('SELECT * FROM checklist_items'),
        routes: t('SELECT * FROM routes'),
        settings: t('SELECT * FROM settings'),
        verification_overrides: t('SELECT * FROM verification_overrides'),
        position_overrides: t('SELECT * FROM position_overrides'),
        activity_log: t('SELECT * FROM activity_log ORDER BY id DESC LIMIT 5000'),
      },
    };
  }

  importAll(data: UserExport, mode: 'replace' | 'merge'): Record<string, number> {
    validateUserExport(data);
    const counts: Record<string, number> = {};
    tx(this.db, () => {
      for (const table of USER_TABLES) {
        const rows = (data.tables[table] ?? []) as Row[];
        if (mode === 'replace') this.db.exec(`DELETE FROM ${table}`);
        const cols = USER_TABLE_COLUMNS[table];
        const st = this.db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
        let n = 0;
        for (const row of rows) {
          if (table === 'activity_log' && mode === 'merge') continue;
          st.run(...cols.map((c) => (row[c] === undefined ? null : row[c]) as string | number | null));
          n++;
        }
        counts[table] = n;
      }
    });
    return counts;
  }
}

export const USER_TABLES = ['progress', 'custom_markers', 'checklists', 'checklist_items', 'routes', 'settings', 'verification_overrides', 'position_overrides', 'activity_log'] as const;

const USER_TABLE_COLUMNS: Record<(typeof USER_TABLES)[number], string[]> = {
  progress: ['location_id', 'visited', 'collected', 'completed', 'favorite', 'planned', 'notes', 'updated_at', 'visited_at', 'completed_at'],
  custom_markers: ['id', 'name', 'x', 'y', 'icon', 'color', 'notes', 'created_at', 'updated_at'],
  checklists: ['id', 'name', 'created_at'],
  checklist_items: ['id', 'checklist_id', 'text', 'location_id', 'done', 'sort'],
  routes: ['id', 'name', 'waypoints', 'start', 'created_at'],
  settings: ['key', 'value'],
  verification_overrides: ['location_id', 'verification', 'note', 'at'],
  position_overrides: ['location_id', 'x', 'y', 'note', 'at'],
  activity_log: ['id', 'at', 'action', 'location_id', 'detail'],
};

export interface UserExport {
  format: 'leonida-intelligence-user-backup';
  version: number;
  exportedAt: string;
  tables: Partial<Record<(typeof USER_TABLES)[number], unknown[]>>;
}

export function validateUserExport(data: unknown): asserts data is UserExport {
  if (!data || typeof data !== 'object') throw new Error('Backup is not a JSON object');
  const d = data as UserExport;
  if (d.format !== 'leonida-intelligence-user-backup') throw new Error('Not a Leonida Intelligence backup file');
  if (typeof d.version !== 'number' || d.version > 1) throw new Error(`Unsupported backup version ${d.version}`);
  if (!d.tables || typeof d.tables !== 'object') throw new Error('Backup has no tables');
  for (const [k, v] of Object.entries(d.tables)) {
    if (!(USER_TABLES as readonly string[]).includes(k)) throw new Error(`Unknown table in backup: ${k}`);
    if (!Array.isArray(v)) throw new Error(`Table ${k} is not an array`);
    for (const row of v) if (!row || typeof row !== 'object') throw new Error(`Invalid row in ${k}`);
  }
  for (const row of (d.tables.progress ?? []) as Row[]) {
    if (typeof row.location_id !== 'string') throw new Error('progress row without location_id');
  }
  for (const row of (d.tables.custom_markers ?? []) as Row[]) {
    if (typeof row.x !== 'number' || typeof row.y !== 'number' || typeof row.id !== 'string') throw new Error('invalid custom marker row');
  }
}
