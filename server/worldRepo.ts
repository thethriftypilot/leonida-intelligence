import crypto from 'node:crypto';
import type { DB } from './db.ts';
import { nowIso } from './db.ts';
import type {
  LocationRecord, ReviewItem, SourceInfo, SourceRunReport, UpdateRun, Verification,
} from '../shared/types.ts';

/** Fields an adapter provides. Identity/timestamps/versioning are managed by the repository. */
export type NormalizedRecord = Omit<
  LocationRecord,
  'id' | 'sourceId' | 'firstSeen' | 'updatedAt' | 'version' | 'status' | 'mergedInto' | 'coordSystem' | 'redacted'
> & { sourceTime?: string | null };

const CONTENT_FIELDS = [
  'name', 'group', 'category', 'subcategory', 'tags', 'description', 'steps', 'x', 'y', 'precision', 'region',
  'neighborhood', 'address', 'availability', 'chapterMin', 'missable', 'characters', 'rewards', 'repeatable',
  'enterable', 'media', 'sourceUrl', 'sourceLabel', 'links', 'evidence', 'verification', 'confidence', 'spoiler', 'relatedId',
] as const;

export function contentHash(r: NormalizedRecord): string {
  const obj: Record<string, unknown> = {};
  for (const f of CONTENT_FIELDS) {
    let v = (r as Record<string, unknown>)[f];
    if (typeof v === 'number' && (f === 'x' || f === 'y')) v = Math.round(v * 100) / 100;
    obj[f] = v ?? null;
  }
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex');
}

type Row = Record<string, unknown>;

export function rowToLocation(r: Row): LocationRecord {
  return {
    id: r.id as string,
    sourceId: r.source_id as string,
    sourceKey: r.source_key as string,
    name: r.name as string,
    group: r.grp as string,
    category: r.category as string,
    subcategory: (r.subcategory as string) ?? null,
    tags: JSON.parse(r.tags as string),
    description: (r.description as string) ?? null,
    steps: JSON.parse(r.steps as string),
    x: (r.x as number) ?? null,
    y: (r.y as number) ?? null,
    coordSystem: 'gtadb-vi',
    precision: r.precision as LocationRecord['precision'],
    region: (r.region as string) ?? null,
    neighborhood: (r.neighborhood as string) ?? null,
    address: (r.address as string) ?? null,
    availability: (r.availability as string) ?? null,
    chapterMin: (r.chapter_min as number) ?? null,
    missable: !!r.missable,
    characters: (r.characters as string) ?? null,
    rewards: (r.rewards as string) ?? null,
    repeatable: r.repeatable === null || r.repeatable === undefined ? null : !!r.repeatable,
    enterable: !!r.enterable,
    media: JSON.parse(r.media as string),
    sourceUrl: (r.source_url as string) ?? null,
    sourceLabel: (r.source_label as string) ?? null,
    links: JSON.parse(r.links as string),
    evidence: (r.evidence as string) ?? null,
    verification: r.verification as Verification,
    confidence: r.confidence as number,
    spoiler: r.spoiler as LocationRecord['spoiler'],
    relatedId: (r.related_id as string) ?? null,
    firstSeen: r.first_seen as string,
    updatedAt: r.updated_at as string,
    version: r.version as number,
    status: r.status as LocationRecord['status'],
    mergedInto: (r.merged_into as string) ?? null,
  };
}

export type UpsertOutcome = 'added' | 'updated' | 'unchanged' | 'restored';

export class WorldRepo {
  db: DB;
  constructor(db: DB) {
    this.db = db;
  }

  // ---------------------------------------------------------------- locations
  all(includeInactive = false): LocationRecord[] {
    const rows = this.db.prepare(`SELECT * FROM locations ${includeInactive ? '' : "WHERE status = 'active'"} ORDER BY name`).all() as Row[];
    return rows.map(rowToLocation);
  }

  get(id: string): LocationRecord | null {
    const r = this.db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as Row | undefined;
    return r ? rowToLocation(r) : null;
  }

  countActive(sourceId?: string): number {
    const r = sourceId
      ? this.db.prepare("SELECT COUNT(*) c FROM locations WHERE status='active' AND source_id=?").get(sourceId)
      : this.db.prepare("SELECT COUNT(*) c FROM locations WHERE status='active'").get();
    return (r as { c: number }).c;
  }

  activeKeys(sourceId: string): Set<string> {
    const rows = this.db.prepare("SELECT source_key FROM locations WHERE source_id=? AND status='active'").all(sourceId) as Row[];
    return new Set(rows.map((r) => r.source_key as string));
  }

  makeId(sourceId: string, key: string): string {
    return `${sourceId}:${key}`;
  }

  upsert(sourceId: string, rec: NormalizedRecord, runId: number | null, opts: { initial: boolean }): UpsertOutcome {
    const now = nowIso();
    const hash = contentHash(rec);
    const existing = this.db.prepare('SELECT * FROM locations WHERE source_id=? AND source_key=?').get(sourceId, rec.sourceKey) as Row | undefined;
    const params = {
      name: rec.name, grp: rec.group, category: rec.category, subcategory: rec.subcategory,
      tags: JSON.stringify(rec.tags), description: rec.description, steps: JSON.stringify(rec.steps),
      x: rec.x, y: rec.y, precision: rec.precision, region: rec.region, neighborhood: rec.neighborhood,
      address: rec.address, availability: rec.availability, chapter_min: rec.chapterMin, missable: rec.missable ? 1 : 0,
      characters: rec.characters, rewards: rec.rewards, repeatable: rec.repeatable === null ? null : rec.repeatable ? 1 : 0,
      enterable: rec.enterable ? 1 : 0, media: JSON.stringify(rec.media), source_url: rec.sourceUrl,
      source_label: rec.sourceLabel, links: JSON.stringify(rec.links), evidence: rec.evidence,
      verification: rec.verification, confidence: rec.confidence, spoiler: rec.spoiler, related_id: rec.relatedId,
      source_time: rec.sourceTime ?? null, content_hash: hash,
    };
    if (!existing) {
      const id = this.makeId(sourceId, rec.sourceKey);
      this.db.prepare(`
        INSERT INTO locations (id, source_id, source_key, name, grp, category, subcategory, tags, description, steps, x, y,
          precision, region, neighborhood, address, availability, chapter_min, missable, characters, rewards, repeatable,
          enterable, media, source_url, source_label, links, evidence, verification, confidence, spoiler, related_id,
          first_seen, updated_at, discovered_at, source_time, version, status, content_hash)
        VALUES (:id, :source_id, :source_key, :name, :grp, :category, :subcategory, :tags, :description, :steps, :x, :y,
          :precision, :region, :neighborhood, :address, :availability, :chapter_min, :missable, :characters, :rewards, :repeatable,
          :enterable, :media, :source_url, :source_label, :links, :evidence, :verification, :confidence, :spoiler, :related_id,
          :now, :now, :discovered_at, :source_time, 1, 'active', :content_hash)
      `).run({
        ...params, id, source_id: sourceId, source_key: rec.sourceKey, now,
        discovered_at: opts.initial ? (rec.sourceTime ?? null) : now,
      });
      this.history(id, runId, 'added', null);
      return 'added';
    }
    if (existing.content_hash === hash) {
      if (existing.status !== 'active') {
        this.db.prepare("UPDATE locations SET status='active', updated_at=?, version=version+1 WHERE id=?").run(now, existing.id as string);
        this.history(existing.id as string, runId, 'restored', null);
        return 'restored';
      }
      return 'unchanged';
    }
    const before = rowToLocation(existing);
    const diff: Record<string, [unknown, unknown]> = {};
    for (const f of CONTENT_FIELDS) {
      const a = (before as unknown as Record<string, unknown>)[f] ?? null;
      const b = (rec as unknown as Record<string, unknown>)[f] ?? null;
      if (JSON.stringify(a) !== JSON.stringify(b)) diff[f] = [a, b];
    }
    this.db.prepare(`
      UPDATE locations SET name=:name, grp=:grp, category=:category, subcategory=:subcategory, tags=:tags,
        description=:description, steps=:steps, x=:x, y=:y, precision=:precision, region=:region, neighborhood=:neighborhood,
        address=:address, availability=:availability, chapter_min=:chapter_min, missable=:missable, characters=:characters,
        rewards=:rewards, repeatable=:repeatable, enterable=:enterable, media=:media, source_url=:source_url,
        source_label=:source_label, links=:links, evidence=:evidence, verification=:verification, confidence=:confidence,
        spoiler=:spoiler, related_id=:related_id, source_time=:source_time, content_hash=:content_hash,
        updated_at=:now, version=version+1, status='active'
      WHERE id=:id
    `).run({ ...params, now, id: existing.id as string });
    this.history(existing.id as string, runId, existing.status === 'active' ? 'updated' : 'restored', diff);
    return existing.status === 'active' ? 'updated' : 'restored';
  }

  markRemoved(sourceId: string, keys: string[], runId: number | null): number {
    const now = nowIso();
    const st = this.db.prepare("UPDATE locations SET status='removed', verification='outdated', updated_at=?, version=version+1 WHERE source_id=? AND source_key=? AND status='active'");
    let n = 0;
    for (const k of keys) {
      const r = st.run(now, sourceId, k);
      if (r.changes) {
        n++;
        this.history(this.makeId(sourceId, k), runId, 'removed', null);
      }
    }
    return n;
  }

  /** Merge a duplicate into a canonical record (history kept; progress migrated by caller). */
  merge(fromId: string, intoId: string, runId: number | null): void {
    this.db.prepare("UPDATE locations SET status='merged', merged_into=?, updated_at=? WHERE id=?").run(intoId, nowIso(), fromId);
    this.history(fromId, runId, 'merged', { mergedInto: [null, intoId] });
  }

  history(locationId: string, runId: number | null, change: string, diff: unknown): void {
    this.db.prepare('INSERT INTO location_history (location_id, run_id, change, diff, at) VALUES (?, ?, ?, ?, ?)')
      .run(locationId, runId, change, diff ? JSON.stringify(diff) : null, nowIso());
  }

  historyFor(locationId: string): { change: string; diff: unknown; at: string; runId: number | null }[] {
    return (this.db.prepare('SELECT * FROM location_history WHERE location_id=? ORDER BY id DESC LIMIT 50').all(locationId) as Row[])
      .map((r) => ({ change: r.change as string, diff: r.diff ? JSON.parse(r.diff as string) : null, at: r.at as string, runId: (r.run_id as number) ?? null }));
  }

  recentlyDiscovered(sinceIso: string, limit = 200): LocationRecord[] {
    return (this.db.prepare("SELECT * FROM locations WHERE status='active' AND discovered_at >= ? ORDER BY discovered_at DESC LIMIT ?").all(sinceIso, limit) as Row[]).map(rowToLocation);
  }

  maxChapter(): number {
    const r = this.db.prepare("SELECT MAX(chapter_min) m FROM locations WHERE status='active' AND chapter_min < 99").get() as { m: number | null };
    return Math.max(r.m ?? 0, 1);
  }

  // ---------------------------------------------------------------- review queue
  enqueue(item: { kind: ReviewItem['kind']; sourceId: string; sourceKey: string; title: string; url?: string | null; summary?: string | null; suggestedGroup?: string | null; payload?: unknown }): boolean {
    const r = this.db.prepare(`
      INSERT OR IGNORE INTO review_queue (kind, source_id, source_key, title, url, summary, suggested_group, payload, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(item.kind, item.sourceId, item.sourceKey, item.title, item.url ?? null, item.summary ?? null, item.suggestedGroup ?? null, JSON.stringify(item.payload ?? null), nowIso());
    return r.changes > 0;
  }

  reviewList(status = 'pending', kind?: string, limit = 500): ReviewItem[] {
    const rows = (kind
      ? this.db.prepare('SELECT * FROM review_queue WHERE status=? AND kind=? ORDER BY id DESC LIMIT ?').all(status, kind, limit)
      : this.db.prepare('SELECT * FROM review_queue WHERE status=? ORDER BY id DESC LIMIT ?').all(status, limit)) as Row[];
    return rows.map((r) => ({
      id: r.id as number, kind: r.kind as ReviewItem['kind'], sourceId: r.source_id as string, sourceKey: r.source_key as string,
      title: r.title as string, url: (r.url as string) ?? null, summary: (r.summary as string) ?? null,
      suggestedGroup: (r.suggested_group as string) ?? null, payload: JSON.parse(r.payload as string),
      status: r.status as ReviewItem['status'], createdAt: r.created_at as string, resolvedAt: (r.resolved_at as string) ?? null,
      locationId: (r.location_id as string) ?? null,
    }));
  }

  reviewGet(id: number): ReviewItem | null {
    const r = this.db.prepare('SELECT * FROM review_queue WHERE id=?').get(id) as Row | undefined;
    if (!r) return null;
    return this.reviewList(r.status as string, r.kind as string, 100000).find((x) => x.id === id) ?? null;
  }

  reviewResolve(id: number, status: ReviewItem['status'], locationId: string | null = null): void {
    this.db.prepare('UPDATE review_queue SET status=?, resolved_at=?, location_id=? WHERE id=?').run(status, nowIso(), locationId, id);
  }

  reviewCounts(): Record<string, number> {
    const rows = this.db.prepare("SELECT kind, COUNT(*) c FROM review_queue WHERE status='pending' GROUP BY kind").all() as Row[];
    return Object.fromEntries(rows.map((r) => [r.kind as string, r.c as number]));
  }

  pruneLeads(days: number): number {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    return Number(this.db.prepare("DELETE FROM review_queue WHERE kind='lead' AND status != 'pending' AND resolved_at < ?").run(cutoff).changes);
  }

  // ---------------------------------------------------------------- sources
  ensureSource(s: { id: string; name: string; kind: string; description: string; homepage: string; license: string; attribution: string; defaultEnabled: boolean; defaultConfig: unknown }): void {
    this.db.prepare(`
      INSERT INTO sources (id, name, kind, description, homepage, license, attribution, enabled, config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, description=excluded.description,
        homepage=excluded.homepage, license=excluded.license, attribution=excluded.attribution
    `).run(s.id, s.name, s.kind, s.description, s.homepage, s.license, s.attribution, s.defaultEnabled ? 1 : 0, JSON.stringify(s.defaultConfig ?? {}));
  }

  sourceRow(id: string): Row | null {
    return (this.db.prepare('SELECT * FROM sources WHERE id=?').get(id) as Row | undefined) ?? null;
  }

  sources(): SourceInfo[] {
    const counts = Object.fromEntries((this.db.prepare("SELECT source_id, COUNT(*) c FROM locations WHERE status='active' GROUP BY source_id").all() as Row[]).map((r) => [r.source_id, r.c]));
    return (this.db.prepare('SELECT * FROM sources ORDER BY rowid').all() as Row[]).map((r) => ({
      id: r.id as string, name: r.name as string, kind: r.kind as SourceInfo['kind'], description: r.description as string,
      homepage: r.homepage as string, license: r.license as string, attribution: r.attribution as string, enabled: !!r.enabled,
      lastRunAt: (r.last_run_at as string) ?? null, lastSuccessAt: (r.last_success_at as string) ?? null,
      lastStatus: r.last_status as SourceInfo['lastStatus'], lastError: (r.last_error as string) ?? null,
      revision: (r.revision as string) ?? null, recordCount: (counts[r.id as string] as number) ?? 0,
    }));
  }

  sourceConfig(id: string): { config: Record<string, unknown>; state: Record<string, unknown> } {
    const r = this.sourceRow(id);
    return { config: r ? JSON.parse(r.config as string) : {}, state: r ? JSON.parse(r.state as string) : {} };
  }

  setSourceEnabled(id: string, enabled: boolean): void {
    this.db.prepare('UPDATE sources SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
  }

  setSourceConfig(id: string, config: unknown): void {
    this.db.prepare('UPDATE sources SET config=? WHERE id=?').run(JSON.stringify(config), id);
  }

  recordSourceRun(id: string, rep: SourceRunReport, state?: unknown): void {
    const now = nowIso();
    const ok = rep.status === 'ok' || rep.status === 'unchanged';
    this.db.prepare(`
      UPDATE sources SET last_run_at=?, last_status=?, last_error=?,
        last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END,
        revision = COALESCE(?, revision), state = COALESCE(?, state)
      WHERE id=?
    `).run(now, rep.status, rep.error, ok ? 1 : 0, now, rep.revision, state === undefined ? null : JSON.stringify(state), id);
  }

  // ---------------------------------------------------------------- runs
  startRun(trigger: UpdateRun['trigger']): number {
    return Number(this.db.prepare("INSERT INTO update_runs (trigger, started_at, status) VALUES (?, ?, 'running')").run(trigger, nowIso()).lastInsertRowid);
  }

  finishRun(id: number, status: UpdateRun['status'], reports: SourceRunReport[], summary: string): void {
    this.db.prepare('UPDATE update_runs SET finished_at=?, status=?, report=?, summary=? WHERE id=?').run(nowIso(), status, JSON.stringify(reports), summary, id);
  }

  runs(limit = 50): UpdateRun[] {
    return (this.db.prepare('SELECT * FROM update_runs ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      id: r.id as number, trigger: r.trigger as UpdateRun['trigger'], startedAt: r.started_at as string,
      finishedAt: (r.finished_at as string) ?? null, status: r.status as UpdateRun['status'],
      sources: JSON.parse(r.report as string), summary: r.summary as string,
    }));
  }

  lastRun(): UpdateRun | null {
    return this.runs(1)[0] ?? null;
  }

  lastSuccessfulRun(): UpdateRun | null {
    const r = this.db.prepare("SELECT id FROM update_runs WHERE status IN ('ok','partial') ORDER BY id DESC LIMIT 1").get() as Row | undefined;
    return r ? this.runs(1000).find((x) => x.id === r.id) ?? null : null;
  }

  failStaleRuns(): void {
    this.db.prepare("UPDATE update_runs SET status='error', finished_at=?, summary='Interrupted (application stopped during update)' WHERE status='running'").run(nowIso());
  }

  pruneRuns(keep = 300): void {
    this.db.prepare('DELETE FROM update_runs WHERE id NOT IN (SELECT id FROM update_runs ORDER BY id DESC LIMIT ?)').run(keep);
  }
}
