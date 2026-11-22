// "GTA 6 Loot Map" community dataset adapter (MIT licence).
// https://github.com/theihtishaam/GTA-6-Interactive-Map-and-Loot-Tracker
// Provides post-release gameplay guides (bank jobs, collectibles, activities, rewards) and the
// mission list, each with a link to the original publisher article and, where available,
// coordinates registered from the publisher's in-game map screenshot onto the GTADB frame.

import fs from 'node:fs';
import path from 'node:path';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';
import type { NormalizedRecord } from '../worldRepo.ts';
import { expectOk } from './http.ts';
import { isValidGameCoord, lootNormalizedToGame } from '../../shared/coords.ts';
import type { Precision, SourceLink, SpoilerLevel, Verification } from '../../shared/types.ts';

export const LOOT_REPO = 'theihtishaam/GTA-6-Interactive-Map-and-Loot-Tracker';
const FILES = ['guides.json', 'collectible-guides.json', 'guide-positions.json', 'missions.json', 'mission-positions.json'] as const;
type FileName = (typeof FILES)[number];
const DATASET_LABEL = 'GTA 6 Loot Map dataset (MIT)';

interface Guide {
  id: string; title: string; category: string; subcategory?: string; region?: string; x?: number; y?: number;
  source?: string; sourceLabel?: string; details?: string; steps?: string[]; confidence?: string; landmarkId?: string;
  precision?: string; landmark?: string; locationSource?: string; secondarySource?: string; evidenceNote?: string;
  collectibleSet?: string; collectibleIndex?: number; setSize?: number; sourceImage?: string;
  markerAlignment?: { inliers?: number; p90ImagePixels?: number };
}

interface Position {
  x: number; y: number; precision?: string; locationSource?: string; sourceImage?: string; evidenceNote?: string;
  markerAlignment?: { inliers?: number; p90ImagePixels?: number };
}

interface Mission {
  id: string; title: string; chapter: number; kind: string; character?: string; area?: string; contact?: string;
  prerequisite?: string; steps?: string[]; source?: string; sourceLabel?: string; secondarySource?: string;
  notes?: string; startImage?: string; strand?: string; actionLabel?: string; startVenue?: string;
}

const GUIDE_MAP: Record<string, (sub: string) => [string, string, SpoilerLevel]> = {
  heist: (sub) => (sub === 'Story jobs' ? ['story', 'Story jobs', 'story'] : ['money', sub || 'Robberies', 'gameplay']),
  earbuds: () => ['services', 'Electronics (earbuds & headphones)', 'gameplay'],
  bag: (sub) => ['weapons', sub || 'Equipment', 'gameplay'],
  collectible: (sub) => ['collectibles', sub || 'Collectibles', 'gameplay'],
  leisure: (sub) => ['activities', sub || 'Leisure', 'gameplay'],
  reward: (sub) => {
    switch (sub) {
      case 'Underwater treasure': return ['secrets', 'Underwater treasure', 'gameplay'];
      case 'Vehicles & garages': return ['vehicles', 'Garages & vehicle rewards', 'gameplay'];
      case 'Clothing': return ['services', 'Clothing rewards', 'gameplay'];
      case 'Trophies': return ['collectibles', 'Trophies & achievements', 'gameplay'];
      case 'Race challenges': return ['collectibles', 'Race challenges', 'gameplay'];
      default: return ['collectibles', sub || 'Rewards', 'gameplay'];
    }
  },
};

const MISSION_CATEGORY: Record<string, string> = {
  story: 'Story missions', stranger: 'Strangers & side contacts', side: 'Side missions', optional: 'Optional missions',
};

export function chaptersMentioned(text: string): number[] {
  return [...text.matchAll(/\bChapter\s+(\d{1,2})\b/gi)].map((m) => Number(m[1]));
}

export function looksMissable(text: string): boolean {
  return /\b(only|before leaving|time-sensitive|separate save|missable|before .* closes)\b/i.test(text);
}

function precisionOf(p?: string): Precision {
  switch (p) {
    case 'map-marker':
    case 'mission-marker': return 'marker';
    case 'venue': return 'venue';
    case 'area': return 'area';
    default: return 'approximate';
  }
}

function rewardsOf(text: string): string | null {
  const m = text.match(/GTA\$[\d,]+(?:\s*[–-]\s*[\d,]+)?/);
  return m ? m[0] : null;
}

function linksOf(entries: [string, string | undefined][]): SourceLink[] {
  const seen = new Set<string>();
  const out: SourceLink[] = [];
  for (const [label, url] of entries) {
    if (!url || !/^https?:\/\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ label, url });
  }
  return out;
}

function alignmentNote(a?: { inliers?: number; p90ImagePixels?: number }): string {
  if (!a?.inliers) return '';
  return `Screenshot registration: ${a.inliers} keypoint matches, 90th-percentile residual ${a.p90ImagePixels ?? '?'} px.`;
}

function verificationFor(precision: Precision, hasAlignment: boolean, hasSecondSource: boolean): [Verification, number] {
  if (precision === 'marker' && hasAlignment) return ['corroborated', 0.8];
  if (precision === 'venue' && hasSecondSource) return ['corroborated', 0.75];
  if (precision === 'venue') return ['unconfirmed', 0.6];
  if (precision === 'area') return ['unconfirmed', 0.4];
  return ['unconfirmed', 0.5];
}

export function normalizeGuide(g: Guide, pos: Position | undefined): NormalizedRecord {
  const sub = g.subcategory ?? '';
  const [group, category, spoiler] = (GUIDE_MAP[g.category] ?? ((s: string) => ['collectibles', s || g.category, 'gameplay'] as [string, string, SpoilerLevel]))(sub);
  const text = `${g.details ?? ''} ${(g.steps ?? []).join(' ')}`;
  const chapters = chaptersMentioned(text);
  const nx = pos?.x ?? g.x;
  const ny = pos?.y ?? g.y;
  let x: number | null = null;
  let y: number | null = null;
  if (typeof nx === 'number' && typeof ny === 'number') {
    const c = lootNormalizedToGame(nx, ny);
    if (isValidGameCoord(c.x, c.y)) ({ x, y } = c);
  }
  const precision = x === null ? 'unknown' : precisionOf(pos?.precision ?? g.precision);
  const alignment = pos?.markerAlignment ?? g.markerAlignment;
  const [verification, confidence] = verificationFor(precision, !!alignment?.inliers, !!g.secondarySource);
  const regionParts = (g.region ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const evidence = [
    pos?.evidenceNote ?? g.evidenceNote ?? '',
    alignmentNote(alignment),
    g.landmark ? `Pinned at venue "${g.landmark}".` : '',
    `Dataset: ${DATASET_LABEL}.`,
  ].filter(Boolean).join(' ');
  return {
    sourceKey: g.id,
    name: g.title,
    group, category,
    subcategory: g.collectibleSet && g.setSize ? `${g.collectibleSet} (${g.collectibleIndex ?? '?'}/${g.setSize})` : (sub || null),
    tags: [g.category, sub].filter(Boolean),
    description: g.details ?? null,
    steps: g.steps ?? [],
    x, y, precision,
    region: regionParts.length > 1 ? regionParts[regionParts.length - 1] : regionParts[0] ?? null,
    neighborhood: regionParts.length > 1 ? regionParts[0] : null,
    address: g.landmark ?? null,
    availability: chapters.length ? `Source text references Chapter ${Math.min(...chapters)}` : null,
    chapterMin: chapters.length ? Math.min(...chapters) : null,
    missable: looksMissable(text),
    characters: /\bLucia\b/.test(text) && /\bJason\b/.test(text) ? 'Jason, Lucia' : /\bLucia\b/.test(text) ? 'Lucia' : /\bJason\b/.test(text) ? 'Jason' : null,
    rewards: rewardsOf(text),
    repeatable: /\brepeat/i.test(text) ? true : null,
    enterable: false,
    media: [],
    sourceUrl: g.source ?? null,
    sourceLabel: g.sourceLabel ?? null,
    links: linksOf([
      [g.sourceLabel ? `${g.sourceLabel} guide` : 'Original guide', g.source],
      ['Second source', g.secondarySource],
      ['Location evidence', pos?.locationSource ?? g.locationSource],
      ['Source map screenshot (publisher)', pos?.sourceImage ?? g.sourceImage],
      ['Dataset (GitHub, MIT)', `https://github.com/${LOOT_REPO}`],
    ]),
    evidence,
    verification, confidence, spoiler,
    relatedId: g.landmarkId ? g.landmarkId.replace(/^gtadb-/, 'gtadb:') : null,
  };
}

export function normalizeMission(m: Mission, pos: Position | undefined): NormalizedRecord {
  let x: number | null = null;
  let y: number | null = null;
  if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
    const c = lootNormalizedToGame(pos.x, pos.y);
    if (isValidGameCoord(c.x, c.y)) ({ x, y } = c);
  }
  const spoiler: SpoilerLevel = m.chapter >= 4 ? 'late' : 'story';
  const precision: Precision = x === null ? 'unknown' : precisionOf(pos?.precision);
  const [verification, confidence]: [Verification, number] = x === null ? ['unconfirmed', 0.5] : pos?.markerAlignment?.inliers ? ['corroborated', 0.8] : ['unconfirmed', 0.6];
  const kindLabel = MISSION_CATEGORY[m.kind] ?? 'Missions';
  const desc = [
    `${kindLabel.replace(/s$/, '')}${m.strand ? ` (${m.strand} strand)` : ''}${m.contact ? ` — contact: ${m.contact}` : ''}.`,
    m.prerequisite ? `Prerequisite: ${m.prerequisite}` : '',
    m.notes ?? '',
  ].filter(Boolean).join(' ');
  const areaParts = (m.area ?? '').split('·').map((s) => s.trim()).filter(Boolean);
  return {
    sourceKey: m.id,
    name: m.title,
    group: 'story',
    category: kindLabel,
    subcategory: m.actionLabel ?? null,
    tags: [m.kind, m.strand ?? ''].filter(Boolean),
    description: desc,
    steps: m.steps ?? [],
    x, y, precision,
    region: areaParts[0] ?? null,
    neighborhood: areaParts[1] ?? m.startVenue ?? null,
    address: m.startVenue ?? null,
    availability: `Chapter ${m.chapter}${m.prerequisite ? ` · ${m.prerequisite}` : ''}`,
    chapterMin: m.chapter,
    missable: looksMissable(`${m.notes ?? ''}`),
    characters: m.character ?? null,
    rewards: rewardsOf(`${m.notes ?? ''} ${(m.steps ?? []).join(' ')}`),
    repeatable: false,
    enterable: false,
    media: [],
    sourceUrl: m.source ?? null,
    sourceLabel: m.sourceLabel ?? null,
    links: linksOf([
      [m.sourceLabel ? `${m.sourceLabel} walkthrough` : 'Walkthrough', m.source],
      ['Second source', m.secondarySource],
      ['Mission start screenshot (publisher)', pos?.sourceImage ?? m.startImage],
      ['Dataset (GitHub, MIT)', `https://github.com/${LOOT_REPO}`],
    ]),
    evidence: [pos?.evidenceNote ?? (x === null ? 'Start position not yet registered — kept in the unplaced research queue.' : ''), alignmentNote(pos?.markerAlignment), `Dataset: ${DATASET_LABEL}.`].filter(Boolean).join(' '),
    verification, confidence, spoiler,
    relatedId: null,
  };
}

export function parseLootFiles(files: Record<FileName, unknown>): { records: NormalizedRecord[]; notes: string[] } {
  const guides = files['guides.json'];
  const coll = files['collectible-guides.json'];
  const missions = files['missions.json'];
  const gpos = (files['guide-positions.json'] ?? {}) as Record<string, Position>;
  const mpos = (files['mission-positions.json'] ?? {}) as Record<string, Position>;
  if (!Array.isArray(guides) || !Array.isArray(missions)) throw new Error('Loot Map dataset: unexpected file format');
  const records: NormalizedRecord[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const g of [...(guides as Guide[]), ...((Array.isArray(coll) ? coll : []) as Guide[])]) {
    if (!g?.id || !g.title || seen.has(g.id)) continue;
    seen.add(g.id);
    records.push(normalizeGuide(g, gpos[g.id]));
  }
  for (const m of missions as Mission[]) {
    if (!m?.id || !m.title || typeof m.chapter !== 'number' || seen.has(m.id)) continue;
    seen.add(m.id);
    records.push(normalizeMission(m, mpos[m.id]));
  }
  const unplaced = records.filter((r) => r.x === null).length;
  if (unplaced) notes.push(`${unplaced} entries have no registered position (kept in unplaced queue)`);
  if (records.length < 20) throw new Error(`Loot Map dataset: only ${records.length} records — upstream format may have changed`);
  return { records, notes };
}

export const lootMapAdapter: SourceAdapter = {
  id: 'lootmap',
  name: 'GTA 6 Loot Map — guides & missions',
  kind: 'dataset',
  description: 'Open (MIT) community dataset of post-release gameplay guides (bank jobs, collectibles, activities, rewards) and missions, each linked to its publisher walkthrough, with screenshot-registered coordinates on the GTADB frame.',
  homepage: `https://github.com/${LOOT_REPO}`,
  license: 'MIT (dataset); linked articles © their publishers',
  attribution: 'GTA 6 Loot Map by The Ihtisham and contributors (MIT); guide text summarises and links publisher articles such as PowerPyx and GamesRadar+',
  defaultEnabled: true,
  defaultConfig: { branch: 'main' },

  async run(ctx: AdapterContext): Promise<AdapterResult> {
    const notes: string[] = [];
    const cacheDir = path.join(ctx.dataDir, 'sources', 'lootmap');
    const readDir = (dir: string) => Object.fromEntries(FILES.map((f) => [f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))])) as Record<FileName, unknown>;
    const fromLocal = (dir: string, rev: string, why: string): AdapterResult => {
      notes.push(why);
      const { records, notes: n } = parseLootFiles(readDir(dir));
      return { revision: rev, snapshot: true, records, leads: [], notes: [...notes, ...n] };
    };

    if (ctx.offline) {
      if (ctx.previousRevision) return { revision: ctx.previousRevision, unchanged: true, snapshot: true, records: [], leads: [], notes: ['Offline mode: skipped'] };
      return fromLocal(path.join(ctx.seedDir, 'lootmap'), 'seed-37d5b55', 'Offline mode: using pinned seed copy');
    }

    try {
      const branch = String(ctx.config.branch ?? 'main');
      const apiUrl = `https://api.github.com/repos/${LOOT_REPO}/commits/${branch}`;
      const res = await ctx.http(apiUrl, { headers: { Accept: 'application/vnd.github.sha' } });
      expectOk(res, apiUrl);
      const sha = (await res.text()).trim();
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('GitHub API did not return a commit SHA');
      if (sha === ctx.previousRevision) return { revision: sha, unchanged: true, snapshot: true, records: [], leads: [], notes: [`no upstream changes (${sha.slice(0, 7)})`] };
      const tmp: Record<string, string> = {};
      for (const f of FILES) {
        const url = `https://raw.githubusercontent.com/${LOOT_REPO}/${sha}/public/${f}`;
        const r = await ctx.http(url, { timeoutMs: 60000 });
        expectOk(r, url);
        tmp[f] = await r.text();
      }
      const parsed = Object.fromEntries(Object.entries(tmp).map(([k, v]) => [k, JSON.parse(v)])) as Record<FileName, unknown>;
      const { records, notes: n } = parseLootFiles(parsed);
      fs.mkdirSync(cacheDir, { recursive: true });
      for (const [k, v] of Object.entries(tmp)) fs.writeFileSync(path.join(cacheDir, k), v);
      fs.writeFileSync(path.join(cacheDir, 'REVISION'), sha);
      return { revision: sha, snapshot: true, records, leads: [], notes: [`fetched ${sha.slice(0, 7)}`, ...n] };
    } catch (e) {
      const msg = (e as Error).message;
      if (ctx.previousRevision) throw new Error(msg);
      if (fs.existsSync(path.join(cacheDir, 'REVISION'))) {
        return fromLocal(cacheDir, fs.readFileSync(path.join(cacheDir, 'REVISION'), 'utf8').trim(), `network failed (${msg}); using cached copy`);
      }
      return fromLocal(path.join(ctx.seedDir, 'lootmap'), 'seed-37d5b55', `network failed (${msg}); using pinned seed copy`);
    }
  },
};
