// Manual/file import: GeoJSON, JSON arrays or CSV supplied by the user (for example an
// export of their own marks from another map). Every row must carry coordinates in a
// declared frame; rows without valid coordinates or that duplicate existing records go to
// the review queue instead of the map.

import type { NormalizedRecord } from '../worldRepo.ts';
import { GROUPS } from '../../shared/categories.ts';
import { isValidGameCoord, lootNormalizedToGame } from '../../shared/coords.ts';
import { classifyTitle } from './rss.ts';

export type CoordFormat = 'game' | 'normalized';

export interface ImportOptions {
  format: CoordFormat;
  sourceLabel: string;
  sourceUrl?: string | null;
  defaultGroup?: string;
  defaultCategory?: string;
}

export interface ImportCandidate {
  key: string;
  record: NormalizedRecord | null;
  raw: Record<string, unknown>;
  problem: string | null;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function parseImportPayload(input: string | unknown): Record<string, unknown>[] {
  let data: unknown = input;
  if (typeof input === 'string') {
    const t = input.trim();
    if (t.startsWith('{') || t.startsWith('[')) data = JSON.parse(t);
    else return parseCsv(t);
  }
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const d = data as Record<string, unknown>;
  if (d && d.type === 'FeatureCollection' && Array.isArray(d.features)) {
    return (d.features as Record<string, unknown>[]).map((f) => {
      const geom = f.geometry as { type?: string; coordinates?: unknown[] } | undefined;
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const coords = geom?.type === 'Point' && Array.isArray(geom.coordinates) ? geom.coordinates : [];
      return { ...props, x: props.x ?? coords[0], y: props.y ?? coords[1], id: props.id ?? f.id };
    });
  }
  if (d && Array.isArray(d.locations)) return d.locations as Record<string, unknown>[];
  throw new Error('Unrecognised import format: expected GeoJSON FeatureCollection, JSON array, {locations: []} or CSV with a header row');
}

export function buildImportCandidates(rows: Record<string, unknown>[], opts: ImportOptions): ImportCandidate[] {
  const out: ImportCandidate[] = [];
  rows.slice(0, 5000).forEach((raw, i) => {
    const name = String(raw.name ?? raw.title ?? raw.label ?? '').trim().slice(0, 200);
    const key = String(raw.id ?? raw.key ?? `${name || 'row'}-${i}`).slice(0, 200);
    if (!name) { out.push({ key, record: null, raw, problem: 'missing name' }); return; }
    let x = num(raw.x ?? raw.lng ?? raw.lon);
    let y = num(raw.y ?? raw.lat);
    if (x !== null && y !== null && opts.format === 'normalized') ({ x, y } = lootNormalizedToGame(x, y));
    const valid = x !== null && y !== null && isValidGameCoord(x, y);
    const groupIn = String(raw.group ?? '').toLowerCase();
    const group = GROUPS.some((g) => g.key === groupIn) ? groupIn : opts.defaultGroup ?? classifyTitle(`${name} ${raw.category ?? ''}`) ?? 'landmarks';
    const category = String(raw.category ?? opts.defaultCategory ?? 'Imported').slice(0, 80);
    const url = typeof raw.source_url === 'string' ? raw.source_url : typeof raw.url === 'string' ? raw.url : opts.sourceUrl ?? null;
    const record: NormalizedRecord = {
      sourceKey: key,
      name, group, category, subcategory: null, tags: ['imported'],
      description: typeof raw.description === 'string' ? raw.description.slice(0, 4000) : null,
      steps: [], x: valid ? x : null, y: valid ? y : null, precision: valid ? 'approximate' : 'unknown',
      region: typeof raw.region === 'string' ? raw.region : null, neighborhood: null, address: null,
      availability: null, chapterMin: num(raw.chapter), missable: false, characters: null, rewards: null, repeatable: null,
      enterable: false, media: [], sourceUrl: url && /^https?:\/\//.test(url) ? url : null, sourceLabel: opts.sourceLabel,
      links: url && /^https?:\/\//.test(url) ? [{ label: opts.sourceLabel, url }] : [],
      evidence: `Imported by you from "${opts.sourceLabel}" (${opts.format} coordinates). Not independently verified.`,
      verification: 'unconfirmed', confidence: 0.4, spoiler: raw.spoiler === 'story' ? 'story' : 'gameplay', relatedId: null,
    };
    out.push({ key, record, raw, problem: valid ? null : 'missing or out-of-bounds coordinates' });
  });
  return out;
}
