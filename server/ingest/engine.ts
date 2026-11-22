// Research & update engine: runs each source adapter in isolation, validates and merges
// its output, queues anything uncertain, records history and produces a readable report.

import type { SourceAdapter, Http } from './types.ts';
import type { WorldRepo, NormalizedRecord } from '../worldRepo.ts';
import type { UserRepo } from '../userRepo.ts';
import type { BackupManager } from '../backup.ts';
import type { SourceRunReport, UpdateRun } from '../../shared/types.ts';
import { tx } from '../db.ts';
import { isValidGameCoord } from '../../shared/coords.ts';
import { findDuplicate } from './dedupe.ts';
import { buildImportCandidates, parseImportPayload, type ImportOptions } from './manualImport.ts';

export interface EngineDeps {
  world: WorldRepo;
  user: UserRepo;
  backups: BackupManager;
  adapters: SourceAdapter[];
  http: Http;
  dataDir: string;
  seedDir: string;
  offline: boolean;
  log: (msg: string) => void;
  adapterTimeoutMs?: number;
}

export const MANUAL_SOURCE = {
  id: 'manual', name: 'Your imports & placements', kind: 'import' as const,
  description: 'Locations you imported from files or created from research leads after checking them yourself.',
  homepage: '', license: 'Your own data', attribution: 'You', defaultEnabled: true, defaultConfig: {},
};

export class ResearchEngine {
  deps: EngineDeps;
  running: Promise<UpdateRun> | null = null;
  currentRunId: number | null = null;

  constructor(deps: EngineDeps) {
    this.deps = deps;
    for (const a of deps.adapters) deps.world.ensureSource(a);
    deps.world.ensureSource(MANUAL_SOURCE);
    deps.world.failStaleRuns();
  }

  isRunning(): boolean {
    return this.running !== null;
  }

  /** Start an update; if one is already running, return that one. */
  run(trigger: UpdateRun['trigger'], only?: string[]): Promise<UpdateRun> {
    if (this.running) return this.running;
    this.running = this.execute(trigger, only).finally(() => {
      this.running = null;
      this.currentRunId = null;
    });
    return this.running;
  }

  private async execute(trigger: UpdateRun['trigger'], only?: string[]): Promise<UpdateRun> {
    const { world, backups, log } = this.deps;
    try {
      if (world.countActive() > 0) backups.snapshotWorld(world.db, 'pre-update');
    } catch (e) {
      log(`warning: world snapshot failed: ${(e as Error).message}`);
    }
    const runId = world.startRun(trigger);
    this.currentRunId = runId;
    const reports: SourceRunReport[] = [];
    for (const adapter of this.deps.adapters) {
      if (only && !only.includes(adapter.id)) continue;
      const row = world.sourceRow(adapter.id);
      if (!row || !row.enabled) {
        reports.push({ sourceId: adapter.id, status: 'skipped', revision: null, added: 0, updated: 0, unchanged: 0, removed: 0, queued: 0, rejected: 0, error: null, durationMs: 0, notes: ['disabled'] });
        continue;
      }
      reports.push(await this.runAdapter(adapter, runId));
    }
    world.pruneLeads(90);
    world.pruneRuns();
    const errors = reports.filter((r) => r.status === 'error');
    const ran = reports.filter((r) => r.status !== 'skipped');
    const status: UpdateRun['status'] = !ran.length ? 'ok' : errors.length === 0 ? 'ok' : errors.length === ran.length ? 'error' : 'partial';
    const summary = summarize(reports, (id) => world.sourceRow(id)?.name as string ?? id);
    world.finishRun(runId, status, reports, summary);
    log(`update #${runId} (${trigger}) ${status}: ${summary}`);
    return world.runs(1)[0];
  }

  private async runAdapter(adapter: SourceAdapter, runId: number): Promise<SourceRunReport> {
    const { world, log } = this.deps;
    const t0 = Date.now();
    const rep: SourceRunReport = { sourceId: adapter.id, status: 'ok', revision: null, added: 0, updated: 0, unchanged: 0, removed: 0, queued: 0, rejected: 0, error: null, durationMs: 0, notes: [] };
    const { config, state } = world.sourceConfig(adapter.id);
    const prevRevision = (world.sourceRow(adapter.id)?.revision as string) ?? null;
    const firstRun = world.countActive(adapter.id) === 0;
    let newState: unknown;
    try {
      const timeout = this.deps.adapterTimeoutMs ?? 15 * 60_000;
      let timer: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        adapter.run({
          dataDir: this.deps.dataDir, seedDir: this.deps.seedDir, offline: this.deps.offline,
          previousRevision: firstRun ? null : prevRevision, config, state, http: this.deps.http,
          log: (m) => log(`[${adapter.id}] ${m}`), firstRun,
        }),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`adapter timed out after ${Math.round(timeout / 1000)}s`)), timeout); }),
      ]).finally(() => clearTimeout(timer));
      rep.revision = result.revision;
      rep.notes.push(...result.notes);
      newState = result.state;
      if (result.unchanged) {
        rep.status = 'unchanged';
      } else {
        tx(world.db, () => {
          this.mergeRecords(adapter.id, result.records, result.snapshot, runId, firstRun, rep);
          for (const lead of result.leads) {
            if (world.enqueue({ kind: 'lead', sourceId: adapter.id, sourceKey: lead.key, title: lead.title, url: lead.url, summary: lead.summary, suggestedGroup: lead.suggestedGroup, payload: { feed: lead.feed, publishedAt: lead.publishedAt } })) rep.queued++;
          }
        });
      }
    } catch (e) {
      rep.status = 'error';
      rep.error = (e as Error).message.slice(0, 1000);
      log(`[${adapter.id}] error: ${rep.error}`);
    }
    rep.durationMs = Date.now() - t0;
    world.recordSourceRun(adapter.id, rep, newState);
    return rep;
  }

  mergeRecords(sourceId: string, records: NormalizedRecord[], snapshot: boolean, runId: number | null, firstRun: boolean, rep: SourceRunReport): void {
    const { world } = this.deps;
    const before = world.activeKeys(sourceId);
    const seen = new Set<string>();
    for (const rec of records) {
      if (!rec.sourceKey || !rec.name) { rep.rejected++; continue; }
      if (seen.has(rec.sourceKey)) { rep.rejected++; rep.notes.push(`duplicate key ${rec.sourceKey} in source output ignored`); continue; }
      seen.add(rec.sourceKey);
      if (rec.x !== null || rec.y !== null) {
        if (!isValidGameCoord(rec.x, rec.y)) {
          if (world.enqueue({ kind: 'invalid-coordinates', sourceId, sourceKey: rec.sourceKey, title: rec.name, url: rec.sourceUrl, summary: `Source gave coordinates (${rec.x}, ${rec.y}) outside Leonida; stored without a position.`, suggestedGroup: rec.group, payload: { x: rec.x, y: rec.y } })) rep.queued++;
          rec.x = null; rec.y = null; rec.precision = 'unknown';
        }
      }
      const outcome = world.upsert(sourceId, rec, runId, { initial: firstRun });
      if (outcome === 'added') rep.added++;
      else if (outcome === 'updated' || outcome === 'restored') rep.updated++;
      else rep.unchanged++;
    }
    if (snapshot) {
      const missing = [...before].filter((k) => !seen.has(k));
      if (missing.length) {
        if (before.size > 20 && missing.length > before.size * 0.5) {
          rep.notes.push(`upstream is missing ${missing.length} of ${before.size} records — removal skipped as a safety measure (possible upstream format change)`);
        } else {
          rep.removed = world.markRemoved(sourceId, missing, runId);
        }
      }
    }
  }

  /** User-supplied import. Valid, non-duplicate rows are inserted; the rest are queued. */
  importFile(payload: string | unknown, opts: ImportOptions): SourceRunReport {
    const { world } = this.deps;
    const rep: SourceRunReport = { sourceId: MANUAL_SOURCE.id, status: 'ok', revision: null, added: 0, updated: 0, unchanged: 0, removed: 0, queued: 0, rejected: 0, error: null, durationMs: 0, notes: [] };
    const t0 = Date.now();
    const rows = parseImportPayload(payload);
    const cands = buildImportCandidates(rows, opts);
    const existing = world.all();
    tx(world.db, () => {
      for (const c of cands) {
        if (!c.record) { rep.rejected++; rep.notes.push(`${c.key}: ${c.problem}`); continue; }
        const key = `import:${opts.sourceLabel}:${c.key}`.slice(0, 250);
        if (c.problem) {
          if (world.enqueue({ kind: 'invalid-coordinates', sourceId: MANUAL_SOURCE.id, sourceKey: key, title: c.record.name, url: c.record.sourceUrl, summary: c.problem, suggestedGroup: c.record.group, payload: { record: c.record } })) rep.queued++;
          continue;
        }
        const own = world.get(world.makeId(MANUAL_SOURCE.id, key));
        const dup = own ? null : findDuplicate(c.record, existing);
        if (dup) {
          if (world.enqueue({ kind: 'possible-duplicate', sourceId: MANUAL_SOURCE.id, sourceKey: key, title: c.record.name, url: c.record.sourceUrl, summary: `Looks like existing "${dup.match.name}" (${Math.round(dup.distance)} m away, name similarity ${Math.round(dup.similarity * 100)}%).`, suggestedGroup: c.record.group, payload: { record: { ...c.record, sourceKey: key }, duplicateOf: dup.match.id } })) rep.queued++;
          continue;
        }
        const out = world.upsert(MANUAL_SOURCE.id, { ...c.record, sourceKey: key }, null, { initial: false });
        if (out === 'added') rep.added++; else if (out === 'updated') rep.updated++; else rep.unchanged++;
      }
    });
    rep.durationMs = Date.now() - t0;
    world.recordSourceRun(MANUAL_SOURCE.id, rep);
    return rep;
  }

  /** Create a location from a checked lead/queue item with a position the user chose. */
  createManual(rec: NormalizedRecord): string {
    const { world } = this.deps;
    if (!isValidGameCoord(rec.x, rec.y)) throw new Error('A valid position inside Leonida is required');
    world.upsert(MANUAL_SOURCE.id, rec, null, { initial: false });
    return world.makeId(MANUAL_SOURCE.id, rec.sourceKey);
  }
}

export function summarize(reports: SourceRunReport[], nameOf: (id: string) => string): string {
  const parts = reports.filter((r) => r.status !== 'skipped').map((r) => {
    const n = nameOf(r.sourceId);
    if (r.status === 'error') return `${n}: FAILED (${r.error})`;
    if (r.status === 'unchanged') return `${n}: no changes`;
    const bits = [];
    if (r.added) bits.push(`+${r.added} new`);
    if (r.updated) bits.push(`${r.updated} changed`);
    if (r.removed) bits.push(`${r.removed} removed`);
    if (r.queued) bits.push(`${r.queued} queued for review`);
    if (r.rejected) bits.push(`${r.rejected} rejected`);
    return `${n}: ${bits.length ? bits.join(', ') : 'no changes'}`;
  });
  return parts.length ? parts.join('; ') : 'No enabled sources';
}
