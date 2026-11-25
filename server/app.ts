import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import type { AppConfig } from './config.ts';
import { openDatabases, type Databases, nowIso } from './db.ts';
import { WorldRepo } from './worldRepo.ts';
import { UserRepo, validateUserExport, type UserExport } from './userRepo.ts';
import { BackupManager } from './backup.ts';
import { ResearchEngine, MANUAL_SOURCE } from './ingest/engine.ts';
import { createHttp } from './ingest/http.ts';
import type { Http, SourceAdapter } from './ingest/types.ts';
import { gtadbAdapter } from './ingest/gtadb.ts';
import { lootMapAdapter } from './ingest/lootmap.ts';
import { glitchesAdapter } from './ingest/glitches.ts';
import { rssAdapter } from './ingest/rss.ts';
import { Scheduler } from './scheduler.ts';
import { WorldView } from './worldView.ts';
import { isPrivateAddress, loadSecret, parseCookies, safeEqual, sessionToken } from './security.ts';
import { parseQuery, recommend, searchLocations, isDone } from '../shared/search.ts';
import { isValidGameCoord, distance } from '../shared/coords.ts';
import { DEFAULT_SPOILERS, PROGRESS_FLAGS, VERIFICATIONS, type SpoilerSettings, type Verification, type LocationRecord } from '../shared/types.ts';
import type { NormalizedRecord } from './worldRepo.ts';

export interface AppContext {
  cfg: AppConfig;
  dbs: Databases;
  world: WorldRepo;
  user: UserRepo;
  backups: BackupManager;
  engine: ResearchEngine;
  scheduler: Scheduler;
  view: WorldView;
}

export interface BuildOptions {
  adapters?: SourceAdapter[];
  http?: Http;
  startScheduler?: boolean;
  logger?: boolean;
}

class HttpError extends Error {
  statusCode: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.statusCode = code;
  }
}

const bad = (msg: string) => new HttpError(400, msg);
const notFound = (msg = 'not found') => new HttpError(404, msg);

export async function buildApp(cfg: AppConfig, opts: BuildOptions = {}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const log = (m: string) => { if (opts.logger !== false) console.log(`[${new Date().toISOString()}] ${m}`); };
  const backups = new BackupManager(cfg.dataDir, cfg.userBackupKeep);
  const dbs = openDatabases(cfg.dataDir, (file, from, to) => {
    backups.backupUserFile(file, `pre-migration-v${from}-to-v${to}`);
    log(`user database migrated v${from} → v${to} (backup taken first)`);
  });
  const world = new WorldRepo(dbs.world);
  const user = new UserRepo(dbs.user);
  const engine = new ResearchEngine({
    world, user, backups, adapters: opts.adapters ?? [gtadbAdapter, lootMapAdapter, glitchesAdapter, rssAdapter],
    http: opts.http ?? createHttp(), dataDir: cfg.dataDir, seedDir: cfg.seedDir, offline: cfg.offline, log,
  });
  const view = new WorldView(world, user, cfg.tilesDir);
  const scheduler = new Scheduler({ engine, world, user, backups, defaultInterval: cfg.updateIntervalHours, log });
  const ctx: AppContext = { cfg, dbs, world, user, backups, engine, scheduler, view };

  const origRun = engine.run.bind(engine);
  engine.run = (trigger, only) => {
    const p = origRun(trigger, only);
    void p.then(() => view.invalidate(), () => view.invalidate());
    return p;
  };

  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024, trustProxy: false });
  await app.register(fastifyCompress, { global: true, threshold: 2048 });

  const secret = loadSecret(cfg.dataDir);
  const token = cfg.accessPin ? sessionToken(secret, cfg.accessPin) : null;

  app.addHook('onRequest', async (req, reply) => {
    if (!cfg.allowPublicIps && !isPrivateAddress(req.socket.remoteAddress)) {
      reply.code(403).send({ error: 'Leonida Intelligence only accepts connections from your local network.' });
      return reply;
    }
    const url = req.url.split('?')[0];
    if (url.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-li-client'] !== '1') {
        reply.code(403).send({ error: 'missing X-LI-Client header' });
        return reply;
      }
      if (token && !['/api/health', '/api/login', '/api/session'].includes(url)) {
        const c = parseCookies(req.headers.cookie).li_session;
        if (!c || !safeEqual(c, token)) {
          reply.code(401).send({ error: 'login required' });
          return reply;
        }
      }
    }
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    return payload;
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
    const code = err.statusCode ?? (err instanceof SyntaxError ? 400 : 500);
    if (code >= 500) log(`error: ${err.stack ?? err.message}`);
    reply.code(code).send({ error: err.message });
  });

  // -------------------------------------------------------------- helpers
  const spoilerSettings = (req: FastifyRequest): SpoilerSettings => {
    const s = user.settings(cfg.updateIntervalHours).spoilers;
    const q = req.query as Record<string, string>;
    return { ...s, revealUntil: q.reveal === '1' ? Date.now() + 60_000 : 0 };
  };
  const visibleFor = (req: FastifyRequest) => view.visible(spoilerSettings(req));
  const body = <T = Record<string, unknown>>(req: FastifyRequest): T => {
    if (!req.body || typeof req.body !== 'object') throw bad('JSON body required');
    return req.body as T;
  };

  // -------------------------------------------------------------- auth & health
  app.get('/api/health', async () => ({
    ok: true, time: nowIso(), locations: world.countActive(), updating: engine.isRunning(),
    lastRun: world.lastRun()?.status ?? null,
  }));
  app.get('/api/session', async (req) => {
    const c = parseCookies(req.headers.cookie).li_session;
    return { pinRequired: !!token, authenticated: !token || (!!c && safeEqual(c, token)) };
  });
  app.post('/api/login', async (req, reply) => {
    if (!token) return { ok: true };
    const { pin } = body<{ pin: string }>(req);
    if (typeof pin !== 'string' || !safeEqual(sessionToken(secret, pin), token)) {
      await new Promise((r) => setTimeout(r, 800));
      throw new HttpError(401, 'Incorrect PIN');
    }
    reply.header('Set-Cookie', `li_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 365}`);
    return { ok: true };
  });

  // -------------------------------------------------------------- world data
  app.get('/api/meta', async (req) => {
    const { locations } = visibleFor(req);
    return view.meta(locations);
  });

  app.get('/api/locations', async (req) => {
    const { locations, hiddenCount } = visibleFor(req);
    return { locations, hiddenCount, generatedAt: nowIso() };
  });

  app.get('/api/locations/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const loc = visibleFor(req).locations.find((l) => l.id === id);
    if (!loc) throw notFound('Location not found or hidden by spoiler protection');
    const related = loc.relatedId ? visibleFor(req).locations.find((l) => l.id === loc.relatedId) ?? null : null;
    return { location: loc, progress: user.getProgress(id), history: world.historyFor(id), related: related ? { id: related.id, name: related.name } : null };
  });

  app.post('/api/locations/:id/verification', async (req) => {
    const id = (req.params as { id: string }).id;
    if (!world.get(id)) throw notFound();
    const { verification, note } = body<{ verification: Verification | null; note?: string }>(req);
    if (verification !== null && !VERIFICATIONS.includes(verification)) throw bad('invalid verification');
    user.setVerificationOverride(id, verification, note ?? null);
    return { ok: true };
  });

  app.post('/api/locations/:id/position', async (req) => {
    const id = (req.params as { id: string }).id;
    const loc = world.get(id);
    if (!loc) throw notFound();
    if (loc.x !== null) throw bad('This location already has a sourced position');
    const { x, y, note, clear } = body<{ x?: number; y?: number; note?: string; clear?: boolean }>(req);
    if (clear) user.setPositionOverride(id, null, null);
    else {
      if (!isValidGameCoord(x, y)) throw bad('Position must be inside Leonida');
      user.setPositionOverride(id, { x: x!, y: y! }, note ?? null);
    }
    view.invalidate();
    return { ok: true };
  });

  app.get('/api/unplaced', async (req) => {
    return { locations: visibleFor(req).locations.filter((l) => l.x === null) };
  });

  app.get('/api/search', async (req) => {
    const q = String((req.query as Record<string, string>).q ?? '').slice(0, 300);
    const s = spoilerSettings(req);
    const { locations } = view.visible(s);
    const parsed = parseQuery(q, (t) => view.resolvePlace(t));
    const { hits, fallback } = searchLocations(locations, parsed, user.allProgress(), s, 200);
    return {
      query: q, interpretation: parsed.interpretation, fallback,
      near: parsed.near, results: hits.map((h) => ({ id: h.loc.id, name: h.loc.name, group: h.loc.group, category: h.loc.category, score: Math.round(h.score * 10) / 10, distance: h.distance === null ? null : Math.round(h.distance) })),
    };
  });

  app.get('/api/recommendations', async (req) => {
    const s = spoilerSettings(req);
    const { locations } = view.visible(s);
    return { chapter: s.chapter, recommendations: recommend(locations, user.allProgress(), s, 15).map((r) => ({ id: r.loc.id, name: r.loc.name, group: r.loc.group, category: r.loc.category, score: Math.round(r.score * 10) / 10, reasons: r.reasons })) };
  });

  app.get('/api/nearby', async (req) => {
    const q = req.query as Record<string, string>;
    const x = Number(q.x), y = Number(q.y), radius = Math.min(Number(q.radius ?? 1500), 20000);
    if (!isValidGameCoord(x, y)) throw bad('x and y must be inside Leonida');
    const progress = user.allProgress();
    const hideDone = q.hideDone !== '0';
    const groups = q.groups ? q.groups.split(',') : null;
    const res = visibleFor(req).locations
      .filter((l) => l.x !== null && l.y !== null && (!groups || groups.includes(l.group)) && l.category !== 'Unnamed buildings' && (!hideDone || !isDone(progress[l.id])))
      .map((l) => ({ id: l.id, name: l.name, group: l.group, category: l.category, distance: Math.round(distance({ x, y }, { x: l.x!, y: l.y! })) }))
      .filter((l) => l.distance <= radius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 100);
    return { results: res };
  });

  app.get('/api/recent', async (req) => {
    const days = Math.min(Math.max(Number((req.query as Record<string, string>).days ?? 7), 1), 365);
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const visibleIds = new Set(visibleFor(req).locations.map((l) => l.id));
    const recent = world.recentlyDiscovered(since, 500).filter((l) => visibleIds.has(l.id) && l.category !== 'Unnamed buildings');
    return { days, results: recent.map((l) => ({ id: l.id, name: l.name, group: l.group, category: l.category, discoveredAt: (world.db.prepare('SELECT discovered_at d FROM locations WHERE id=?').get(l.id) as { d: string }).d, sourceId: l.sourceId })) };
  });

  // -------------------------------------------------------------- progress
  app.get('/api/progress', async () => user.allProgress());
  app.put('/api/progress/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    if (id.length > 300) throw bad('invalid id');
    const b = body<Record<string, unknown>>(req);
    const patch: Record<string, unknown> = {};
    for (const f of PROGRESS_FLAGS) if (typeof b[f] === 'boolean') patch[f] = b[f];
    if (typeof b.notes === 'string') patch.notes = b.notes;
    if (!Object.keys(patch).length) throw bad('nothing to update');
    if (!world.get(id) && !id.startsWith('mk_')) throw notFound('Unknown location');
    return user.setProgress(id, patch);
  });

  app.get('/api/activity', async () => ({
    recentlyCompleted: user.recentlyCompleted(30),
    recentlyVisited: user.recentlyVisited(30),
  }));

  // -------------------------------------------------------------- personal markers, checklists, routes
  app.get('/api/markers', async () => user.markers());
  app.post('/api/markers', async (req) => {
    const b = body<{ id?: string; name: string; x: number; y: number; icon?: string; color?: string; notes?: string }>(req);
    if (!b.name || typeof b.name !== 'string') throw bad('name required');
    if (!isValidGameCoord(b.x, b.y)) throw bad('Marker must be inside Leonida');
    if (b.color && !/^#[0-9a-f]{6}$/i.test(b.color)) throw bad('invalid colour');
    return user.upsertMarker(b);
  });
  app.delete('/api/markers/:id', async (req) => ({ ok: user.deleteMarker((req.params as { id: string }).id) }));

  app.get('/api/checklists', async () => user.checklists());
  app.post('/api/checklists', async (req) => {
    const { name } = body<{ name: string }>(req);
    if (!name) throw bad('name required');
    return user.createChecklist(name);
  });
  app.put('/api/checklists/:id', async (req) => {
    const { name } = body<{ name: string }>(req);
    user.renameChecklist((req.params as { id: string }).id, name);
    return { ok: true };
  });
  app.delete('/api/checklists/:id', async (req) => ({ ok: user.deleteChecklist((req.params as { id: string }).id) }));
  app.post('/api/checklists/:id/items', async (req) => {
    const { text, locationId } = body<{ text: string; locationId?: string }>(req);
    if (!text) throw bad('text required');
    return user.addChecklistItem((req.params as { id: string }).id, text, locationId ?? null);
  });
  app.put('/api/checklist-items/:id', async (req) => {
    user.updateChecklistItem((req.params as { id: string }).id, body(req));
    return { ok: true };
  });
  app.delete('/api/checklist-items/:id', async (req) => ({ ok: user.deleteChecklistItem((req.params as { id: string }).id) }));

  app.get('/api/routes', async () => user.routes());
  app.post('/api/routes', async (req) => {
    const b = body<{ id?: string; name: string; waypoints: string[]; start: { x: number; y: number } | null }>(req);
    if (!b.name || !Array.isArray(b.waypoints)) throw bad('name and waypoints required');
    return user.saveRoute(b);
  });
  app.delete('/api/routes/:id', async (req) => ({ ok: user.deleteRoute((req.params as { id: string }).id) }));

  // -------------------------------------------------------------- settings
  app.get('/api/settings', async () => ({ ...user.settings(cfg.updateIntervalHours), nextUpdateAt: scheduler.nextRunAt() }));
  app.put('/api/settings', async (req) => {
    const b = body<{ spoilers?: Partial<SpoilerSettings>; updateIntervalHours?: number; myPosition?: { x: number; y: number } | null }>(req);
    if (b.spoilers) {
      const cur = user.settings(cfg.updateIntervalHours).spoilers;
      const next = { ...DEFAULT_SPOILERS, ...cur };
      if (typeof b.spoilers.chapter === 'number' && b.spoilers.chapter >= 0 && b.spoilers.chapter <= 99) next.chapter = Math.floor(b.spoilers.chapter);
      for (const k of ['hideStory', 'hideLate', 'showUnknownChapter'] as const) if (typeof b.spoilers[k] === 'boolean') next[k] = b.spoilers[k];
      const { revealUntil: _r, ...persist } = next;
      user.setSetting('spoilers', persist);
    }
    if (b.updateIntervalHours !== undefined) {
      const h = Number(b.updateIntervalHours);
      if (!Number.isFinite(h) || h < 1 || h > 24 * 14) throw bad('update interval must be between 1 and 336 hours');
      user.setSetting('updateIntervalHours', h);
    }
    if (b.myPosition !== undefined) {
      if (b.myPosition !== null && !isValidGameCoord(b.myPosition.x, b.myPosition.y)) throw bad('position must be inside Leonida');
      user.setSetting('myPosition', b.myPosition);
    }
    return { ...user.settings(cfg.updateIntervalHours), nextUpdateAt: scheduler.nextRunAt() };
  });

  // -------------------------------------------------------------- stats / dashboard
  app.get('/api/stats', async (req) => {
    const { locations, hiddenCount } = visibleFor(req);
    const all = view.records();
    const progress = user.allProgress();
    const trackable = locations.filter((l) => l.group !== 'landmarks');
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const groups = view.groups(locations).map((g) => {
      const items = locations.filter((l) => l.group === g.key);
      return { key: g.key, label: g.label, color: g.color, total: items.length, done: items.filter((l) => isDone(progress[l.id])).length, visited: items.filter((l) => progress[l.id]?.visited).length };
    });
    const done = trackable.filter((l) => isDone(progress[l.id])).length;
    const lastOk = world.lastSuccessfulRun();
    return {
      totalLocations: all.length,
      mapped: all.filter((l) => l.x !== null).length,
      unplaced: all.filter((l) => l.x === null).length,
      visibleLocations: locations.length,
      hiddenBySpoilers: hiddenCount,
      verified: all.filter((l) => l.verification === 'verified').length,
      corroborated: all.filter((l) => l.verification === 'corroborated').length,
      unconfirmed: all.filter((l) => l.verification === 'unconfirmed').length,
      disputed: all.filter((l) => l.verification === 'disputed').length,
      addedThisWeek: world.recentlyDiscovered(weekAgo, 100000).length,
      trackable: trackable.length,
      completed: done,
      completionPct: trackable.length ? Math.round((done / trackable.length) * 1000) / 10 : 0,
      visited: Object.values(progress).filter((p) => p.visited).length,
      unvisited: trackable.filter((l) => !progress[l.id]?.visited && !isDone(progress[l.id])).length,
      favorites: Object.values(progress).filter((p) => p.favorite).length,
      planned: Object.values(progress).filter((p) => p.planned).length,
      groups,
      lastSuccessfulUpdate: lastOk?.finishedAt ?? null,
      lastRun: world.lastRun(),
      nextUpdateAt: scheduler.nextRunAt(),
      updating: engine.isRunning(),
      sources: world.sources(),
      reviewPending: world.reviewCounts(),
    };
  });

  // -------------------------------------------------------------- research / updates
  app.get('/api/sources', async () => world.sources());
  app.put('/api/sources/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    if (!world.sourceRow(id)) throw notFound('unknown source');
    const b = body<{ enabled?: boolean; config?: unknown }>(req);
    if (typeof b.enabled === 'boolean') world.setSourceEnabled(id, b.enabled);
    if (b.config !== undefined) {
      if (!b.config || typeof b.config !== 'object') throw bad('config must be an object');
      world.setSourceConfig(id, b.config);
    }
    return { ok: true, source: world.sources().find((s) => s.id === id), config: world.sourceConfig(id).config };
  });
  app.get('/api/sources/:id/config', async (req) => world.sourceConfig((req.params as { id: string }).id).config);

  app.get('/api/updates', async () => ({ running: engine.isRunning(), currentRunId: engine.currentRunId, runs: world.runs(50), nextUpdateAt: scheduler.nextRunAt() }));
  app.get('/api/updates/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const run = world.runs(1000).find((r) => r.id === id);
    if (!run) throw notFound();
    const changes = world.db.prepare('SELECT h.location_id, h.change, h.diff, l.name FROM location_history h LEFT JOIN locations l ON l.id = h.location_id WHERE h.run_id = ? ORDER BY h.id LIMIT 500').all(id);
    return { run, changes };
  });
  app.post('/api/updates/run', async (req) => {
    const b = (req.body ?? {}) as { sources?: string[]; wait?: boolean };
    const p = engine.run('manual', Array.isArray(b.sources) ? b.sources : undefined);
    if (b.wait) return { run: await p };
    return { started: true, runId: engine.currentRunId };
  });

  app.get('/api/review', async (req) => {
    const q = req.query as Record<string, string>;
    return { items: world.reviewList(q.status ?? 'pending', q.kind || undefined), counts: world.reviewCounts() };
  });
  app.post('/api/review/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const item = world.reviewGet(id);
    if (!item) throw notFound();
    const b = body<{ action: 'approve' | 'reject' | 'dismiss'; x?: number; y?: number; name?: string; group?: string; category?: string; description?: string }>(req);
    if (b.action === 'reject' || b.action === 'dismiss') {
      world.reviewResolve(id, b.action === 'reject' ? 'rejected' : 'dismissed');
      return { ok: true };
    }
    if (b.action !== 'approve') throw bad('action must be approve, reject or dismiss');
    const payload = (item.payload ?? {}) as { record?: NormalizedRecord; duplicateOf?: string };
    const base: NormalizedRecord = payload.record ?? {
      sourceKey: `lead:${item.sourceKey}`.slice(0, 250), name: item.title, group: item.suggestedGroup ?? 'landmarks', category: 'Community finds',
      subcategory: null, tags: ['from-lead'], description: item.summary, steps: [], x: null, y: null, precision: 'approximate',
      region: null, neighborhood: null, address: null, availability: null, chapterMin: null, missable: false, characters: null,
      rewards: null, repeatable: null, enterable: false, media: [], sourceUrl: item.url, sourceLabel: item.sourceId === 'feeds' ? 'Community/guide feed' : item.sourceId,
      links: item.url ? [{ label: 'Original post', url: item.url }] : [], evidence: 'Created by you from a research lead after reviewing the source.',
      verification: 'unconfirmed', confidence: 0.45, spoiler: 'gameplay', relatedId: null,
    };
    const rec: NormalizedRecord = {
      ...base,
      name: (b.name ?? base.name).slice(0, 200),
      group: b.group ?? base.group,
      category: (b.category ?? base.category).slice(0, 80),
      description: b.description ?? base.description,
      x: typeof b.x === 'number' ? b.x : base.x,
      y: typeof b.y === 'number' ? b.y : base.y,
      precision: 'approximate',
      evidence: `${base.evidence ?? ''} Position chosen by you during review.`.trim(),
    };
    let locId: string;
    try { locId = engine.createManual(rec); } catch (e) { throw bad((e as Error).message); }
    world.reviewResolve(id, 'approved', locId);
    view.invalidate();
    return { ok: true, locationId: locId };
  });

  app.post('/api/import', async (req) => {
    const b = body<{ data: unknown; format?: 'game' | 'normalized'; sourceLabel?: string; sourceUrl?: string; defaultGroup?: string; defaultCategory?: string }>(req);
    if (b.data === undefined) throw bad('data required');
    let rep;
    try {
      rep = engine.importFile(b.data, { format: b.format === 'normalized' ? 'normalized' : 'game', sourceLabel: (b.sourceLabel || 'Manual import').slice(0, 80), sourceUrl: b.sourceUrl ?? null, defaultGroup: b.defaultGroup, defaultCategory: b.defaultCategory });
    } catch (e) {
      throw bad((e as Error).message);
    }
    view.invalidate();
    return rep;
  });

  // -------------------------------------------------------------- backups
  app.get('/api/backup/export', async (_req, reply) => {
    const data = user.exportAll();
    reply.header('Content-Disposition', `attachment; filename="leonida-progress-${new Date().toISOString().slice(0, 10)}.json"`);
    return data;
  });
  app.post('/api/backup/restore', async (req) => {
    const b = body<{ backup: UserExport; mode?: 'replace' | 'merge' }>(req);
    try { validateUserExport(b.backup); } catch (e) { throw bad((e as Error).message); }
    backups.backupUser(dbs.user, 'pre-restore');
    const counts = user.importAll(b.backup, b.mode === 'merge' ? 'merge' : 'replace');
    view.invalidate();
    return { ok: true, counts };
  });
  app.get('/api/backups', async () => ({ user: backups.userBackups(), world: backups.worldSnapshots() }));
  app.post('/api/backups', async () => backups.backupUser(dbs.user, 'manual'));
  app.post('/api/backups/:name/restore', async (req) => {
    try { backups.restoreUser(dbs.user, (req.params as { name: string }).name); } catch (e) { throw bad((e as Error).message); }
    view.invalidate();
    return { ok: true };
  });
  app.post('/api/snapshots/:name/restore', async (req) => {
    if (engine.isRunning()) throw new HttpError(409, 'An update is running; try again when it finishes');
    try { backups.restoreWorld(dbs.world, (req.params as { name: string }).name); } catch (e) { throw bad((e as Error).message); }
    view.invalidate();
    return { ok: true };
  });

  // -------------------------------------------------------------- static: tiles + web app
  if (fs.existsSync(cfg.tilesDir)) {
    await app.register(fastifyStatic, {
      root: cfg.tilesDir, prefix: '/tiles/', decorateReply: false, maxAge: '7d', immutable: false,
      allowedPath: (p) => /^\/[\w,]+\/\d+\/\d+,\d+,\d+\.jpg$/.test(p),
    });
  }
  const hasWeb = fs.existsSync(path.join(cfg.webDir, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: cfg.webDir, prefix: '/', wildcard: true, index: ['index.html'], setHeaders(res, p) {
      if (p.endsWith('index.html') || p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
      else if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } });
  }
  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && !url.startsWith('/api/') && !url.startsWith('/tiles/') && hasWeb) {
      reply.type('text/html').header('Cache-Control', 'no-cache').send(fs.readFileSync(path.join(cfg.webDir, 'index.html')));
      return;
    }
    if (url.startsWith('/tiles/')) { reply.code(404).send(); return; }
    reply.code(404).send({ error: hasWeb || url.startsWith('/api/') ? 'not found' : 'Web app not built. Run "npm run build".' });
  });

  app.addHook('onClose', async () => {
    scheduler.stop();
    dbs.close();
  });

  if (opts.startScheduler !== false && cfg.schedulerEnabled) scheduler.start();
  return { app, ctx };
}

export type { LocationRecord };
