// GTADB adapter — https://github.com/rolux/gtadb.org (code MIT, data CC BY 4.0).
// The maintainers ask consumers NOT to fetch live data from gtadb.org but to `git pull`
// the repository instead. This adapter therefore:
//   1. runs `git fetch` on the local sparse checkout (data/sources/gtadb), or
//   2. falls back to the file on GitHub (raw.githubusercontent.com) with a commit check, or
//   3. falls back to the pinned seed copy in seed/gtadb when offline.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';
import type { NormalizedRecord } from '../worldRepo.ts';
import { expectOk } from './http.ts';
import { isValidGameCoord } from '../../shared/coords.ts';

const pexec = promisify(execFile);

export const GTADB_REPO = 'rolux/gtadb.org';
const LANDMARKS_PATH = 'map/data/6/landmarks.json';

type RawLandmark = [string, number[] | null, number[], string, number[] | null, number[], string[], string, number[]];

const HASH_TAGS: Record<string, [string, string]> = {
  '#guns': ['weapons', 'Gun stores'],
  '#modshop': ['vehicles', 'Mod shops'],
  "#pay'n'spray": ['vehicles', "Pay 'n' Spray"],
  '#carwash': ['vehicles', 'Car washes'],
  '#bikeshop': ['vehicles', 'Bike shops'],
  '#airport': ['vehicles', 'Airports & airfields'],
  '#airbase': ['vehicles', 'Airports & airfields'],
  '#marina': ['vehicles', 'Marinas'],
  '#train': ['vehicles', 'Train stations'],
  '#metro': ['vehicles', 'Metro & Metromover'],
  '#metromover': ['vehicles', 'Metro & Metromover'],
  '#bus': ['vehicles', 'Bus stations'],
  '#blimp': ['vehicles', 'Blimp'],
  '#racetrack': ['activities', 'Racetracks'],
  '#gas': ['services', 'Gas stations'],
  '#supermarket': ['services', 'Supermarkets & convenience'],
  '#clothes': ['services', 'Clothing stores'],
  '#shoes': ['services', 'Shoe stores'],
  '#hair': ['services', 'Barbers & salons'],
  '#tattoos': ['services', 'Tattoo parlors'],
  '#food': ['services', 'Food & restaurants'],
  '#fastfood': ['services', 'Food & restaurants'],
  '#drinks': ['services', 'Food & restaurants'],
  '#liquor': ['services', 'Liquor stores'],
  '#pharmacy': ['services', 'Pharmacies'],
  '#electronics': ['services', 'Electronics stores'],
  '#vendor': ['services', 'Street vendors'],
  '#safehouse': ['services', 'Safehouses'],
  '#hospital': ['services', 'Hospitals'],
  '#police': ['services', 'Police stations'],
  '#jail': ['services', 'Prisons & jails'],
  '#fence': ['money', 'Fences'],
  '#bar': ['activities', 'Bars'],
  '#nightclub': ['activities', 'Nightclubs'],
  '#stripclub': ['activities', 'Strip clubs'],
  '#cinema': ['activities', 'Cinemas'],
  '#golf': ['activities', 'Golf'],
  '#tennis': ['activities', 'Tennis'],
  '#gym': ['activities', 'Gyms'],
  '#ferriswheel': ['activities', 'Fairground rides'],
  '#volleyball': ['activities', 'Beach volleyball'],
};

const PLAIN_TAGS: Record<string, [string, string]> = {
  landmark: ['landmarks', 'Landmarks'],
  hotel: ['landmarks', 'Hotels'],
  residential: ['landmarks', 'Residential'],
  retail: ['services', 'Retail'],
  restaurant: ['services', 'Food & restaurants'],
  fastfood: ['services', 'Food & restaurants'],
  supermarket: ['services', 'Supermarkets & convenience'],
  leisure: ['activities', 'Leisure'],
  recreation: ['activities', 'Leisure'],
  events: ['activities', 'Event venues'],
  natural: ['landmarks', 'Natural features'],
  industrial: ['landmarks', 'Industrial'],
  government: ['landmarks', 'Government'],
  public: ['landmarks', 'Public places'],
  transportation: ['landmarks', 'Transport infrastructure'],
  utilities: ['landmarks', 'Utilities'],
  office: ['landmarks', 'Offices'],
  construction: ['landmarks', 'Construction sites'],
  agriculture: ['landmarks', 'Agriculture'],
  'point-of-interest': ['landmarks', 'Points of interest'],
  service: ['services', 'Services'],
  fence: ['money', 'Fences'],
};

const DISPUTED_TAGS = ['//may-not-exist', '//doesnt_exist', '//doesnt-exist?'];

function titleCase(s: string): string {
  return s.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
}

function singular(label: string): string {
  const base = label.split(' & ')[0].toLowerCase();
  return base.replace(/ies$/, 'y').replace(/(?<!s)s$/, '');
}

export function normalizeGtadb(id: string, item: RawLandmark): NormalizedRecord | { skip: string } {
  const [address, igCoords, igPhoto, rlAddressRaw, , , tags, , edited] = item;
  const dup = tags.find((t) => t.startsWith('//duplicate-of-'));
  if (dup) return { skip: `${id} flagged ${dup} upstream` };

  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  const rawName = parts[0] ?? '?';
  const unknownName = rawName === '?' || rawName === '';
  const nameUnconfirmed = !unknownName && rawName.endsWith('?');
  const region = parts.length >= 2 ? parts[parts.length - 1] : null;
  const neighborhood = parts.length >= 3 ? parts[parts.length - 2] : null;

  const hashTags = tags.filter((t) => t.startsWith('#') && !t.startsWith('#/'));
  const plainTags = tags.filter((t) => /^[a-z][a-z-]*$/.test(t));
  const characters = tags.filter((t) => t.startsWith('@')).map((t) => titleCase(t.slice(1)));

  let group = 'landmarks';
  let category = 'Points of interest';
  const ht = hashTags.find((t) => HASH_TAGS[t]);
  if (ht) [group, category] = HASH_TAGS[ht];
  else if (hashTags.length) [group, category] = ['services', titleCase(hashTags[0].slice(1).replace(/[-_]/g, ' '))];
  else if (unknownName) [group, category] = ['landmarks', 'Unnamed buildings'];
  else {
    const pt = plainTags.find((t) => PLAIN_TAGS[t]);
    if (pt) [group, category] = PLAIN_TAGS[pt];
  }

  const typeTag = plainTags.find((t) => PLAIN_TAGS[t]);
  const name = unknownName
    ? `Unnamed ${ht ? singular(category) : typeTag ? singular(PLAIN_TAGS[typeTag][1]) : 'place'}`
    : rawName.replace(/\?$/, '').trim();

  const rl = (rlAddressRaw ?? '').replace(/(?<=.)\?$/, '').trim();
  const rlUnconfirmed = tags.includes('unconfirmed');
  const hasPhoto = Array.isArray(igPhoto) && igPhoto.length === 2;
  const enterable = tags.includes('enterable');

  const place = [neighborhood, region].filter(Boolean).join(', ');
  const descParts = [`Community-mapped ${category === 'Unnamed buildings' ? 'building' : singular(category)}${place ? ` in ${place}` : ''}.`];
  if (enterable) descParts.push('Tagged by the community as enterable.');
  if (rl && rl !== '?') descParts.push(`Real-world counterpart (community match${rlUnconfirmed ? ', unconfirmed' : ''}): ${rl}.`);

  let verification: NormalizedRecord['verification'] = 'unconfirmed';
  let confidence = 0.45;
  if (tags.some((t) => DISPUTED_TAGS.includes(t))) { verification = 'disputed'; confidence = 0.2; }
  else if (!unknownName && !nameUnconfirmed && hasPhoto) { verification = 'corroborated'; confidence = 0.8; }
  else if (hasPhoto) { confidence = 0.6; }
  if (nameUnconfirmed) confidence -= 0.1;

  const x = igCoords && igCoords.length >= 2 ? igCoords[0] : null;
  const y = igCoords && igCoords.length >= 2 ? igCoords[1] : null;
  const latestEdit = Array.isArray(edited) && edited.length ? Math.max(...edited.filter((n) => typeof n === 'number')) : null;

  return {
    sourceKey: id,
    name,
    group,
    category,
    subcategory: null,
    tags: tags.filter((t) => !/^l\d+$/.test(t)),
    description: descParts.join(' '),
    steps: [],
    x, y,
    precision: x === null ? 'unknown' : 'venue',
    region,
    neighborhood,
    address,
    availability: null,
    chapterMin: null,
    missable: false,
    characters: characters.length ? characters.join(', ') : null,
    rewards: null,
    repeatable: null,
    enterable,
    media: hasPhoto ? [{
      url: `https://raw.githubusercontent.com/${GTADB_REPO}/main/map/photos/6/${encodeURIComponent(`${id},ig`)}.jpg?v=${edited?.[1] ?? ''}`,
      kind: 'image', credit: 'In-game photo via GTADB contributors', license: 'CC BY 4.0',
    }] : [],
    sourceUrl: `https://map.gtadb.org/#VI,${id}`,
    sourceLabel: 'GTADB (map.gtadb.org)',
    links: [
      { label: `GTADB landmark ${id}`, url: `https://map.gtadb.org/#VI,${id}` },
      { label: 'GTADB data on GitHub (CC BY 4.0)', url: `https://github.com/${GTADB_REPO}/blob/main/${LANDMARKS_PATH}` },
    ],
    evidence: [
      `GTADB community landmark ${id}.`,
      `In-game name: ${unknownName ? 'unknown' : nameUnconfirmed ? 'unconfirmed' : 'given'}.`,
      `In-game photo: ${hasPhoto ? 'yes' : 'no'}.`,
      tags.some((t) => DISPUTED_TAGS.includes(t)) ? 'Upstream note: may not exist in game.' : '',
    ].filter(Boolean).join(' '),
    verification,
    confidence: Math.max(0.05, Math.min(0.95, confidence)),
    spoiler: 'none',
    relatedId: null,
    sourceTime: latestEdit ? new Date(latestEdit * 1000).toISOString() : null,
  };
}

export function parseGtadbLandmarks(json: unknown): { records: NormalizedRecord[]; notes: string[] } {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('GTADB landmarks: unexpected JSON shape (expected object keyed by id)');
  const records: NormalizedRecord[] = [];
  const notes: string[] = [];
  let skipped = 0;
  let bad = 0;
  for (const [id, item] of Object.entries(json as Record<string, unknown>)) {
    if (!Array.isArray(item) || item.length < 9 || typeof item[0] !== 'string') { bad++; continue; }
    const r = normalizeGtadb(id, item as RawLandmark);
    if ('skip' in r) { skipped++; continue; }
    if (r.x !== null && !isValidGameCoord(r.x, r.y)) {
      notes.push(`${id}: coordinates outside Leonida bounds (${r.x}, ${r.y}); kept unplaced`);
      r.x = null; r.y = null; r.precision = 'unknown';
    }
    records.push(r);
  }
  if (skipped) notes.push(`${skipped} upstream duplicates skipped`);
  if (bad) notes.push(`${bad} malformed entries ignored`);
  if (records.length < 100) throw new Error(`GTADB landmarks: only ${records.length} usable records — upstream format may have changed`);
  return { records, notes };
}

async function git(dir: string, args: string[], timeoutMs = 120000): Promise<string> {
  const { stdout } = await pexec('git', ['-C', dir, ...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

export const gtadbAdapter: SourceAdapter = {
  id: 'gtadb',
  name: 'GTADB community landmarks & map tiles',
  kind: 'dataset',
  description: 'Collaboratively edited GTA VI landmark database (names, positions, in-game photos, POI tags) and map tiles. Updated via git as the maintainers request.',
  homepage: 'https://map.gtadb.org',
  license: 'CC BY 4.0 (data) / MIT (code)',
  attribution: 'GTA VI Landmarks Data & Map Tiles (CC BY 4.0) — https://map.gtadb.org — gtadb.org and all contributors',
  defaultEnabled: true,
  defaultConfig: { method: 'auto' },

  async run(ctx: AdapterContext): Promise<AdapterResult> {
    const notes: string[] = [];
    const repoDir = path.join(ctx.dataDir, 'sources', 'gtadb');
    const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

    const fromSeed = (why: string): AdapterResult => {
      const seed = path.join(ctx.seedDir, 'gtadb', 'landmarks.json');
      notes.push(`Using pinned seed copy (${why}).`);
      const { records, notes: n } = parseGtadbLandmarks(read(seed));
      return { revision: 'seed-d406fea', snapshot: true, records, leads: [], notes: [...notes, ...n] };
    };

    if (ctx.offline) return ctx.previousRevision ? { revision: ctx.previousRevision, unchanged: true, snapshot: true, records: [], leads: [], notes: ['Offline mode: skipped'] } : fromSeed('offline mode');

    // 1. git
    if (fs.existsSync(path.join(repoDir, '.git'))) {
      try {
        await git(repoDir, ['fetch', '--depth', '1', '--filter=blob:none', 'origin', 'main'], 300000);
        const remote = await git(repoDir, ['rev-parse', 'FETCH_HEAD']);
        const local = await git(repoDir, ['rev-parse', 'HEAD']);
        if (remote !== local) {
          await git(repoDir, ['reset', '--hard', 'FETCH_HEAD'], 600000);
          notes.push(`git: updated ${local.slice(0, 7)} → ${remote.slice(0, 7)} (landmarks and map tiles)`);
        }
        if (remote === ctx.previousRevision) return { revision: remote, unchanged: true, snapshot: true, records: [], leads: [], notes: [`git: no upstream changes (${remote.slice(0, 7)})`] };
        const { records, notes: n } = parseGtadbLandmarks(read(path.join(repoDir, LANDMARKS_PATH)));
        return { revision: remote, snapshot: true, records, leads: [], notes: [...notes, ...n] };
      } catch (e) {
        notes.push(`git update failed (${(e as Error).message.split('\n')[0]}); trying GitHub HTTP fallback`);
      }
    }

    // 2. HTTP via GitHub
    try {
      const apiUrl = `https://api.github.com/repos/${GTADB_REPO}/commits?path=${encodeURIComponent(LANDMARKS_PATH)}&per_page=1`;
      const res = await ctx.http(apiUrl, { headers: { Accept: 'application/vnd.github+json' } });
      expectOk(res, apiUrl);
      const commits = await res.json<{ sha: string }[]>();
      const sha = commits[0]?.sha;
      if (!sha) throw new Error('GitHub API returned no commits');
      if (sha === ctx.previousRevision) return { revision: sha, unchanged: true, snapshot: true, records: [], leads: [], notes: [...notes, `GitHub: no changes (${sha.slice(0, 7)})`] };
      const rawUrl = `https://raw.githubusercontent.com/${GTADB_REPO}/${sha}/${LANDMARKS_PATH}`;
      const raw = await ctx.http(rawUrl, { timeoutMs: 60000 });
      expectOk(raw, rawUrl);
      const text = await raw.text();
      const json = JSON.parse(text);
      const cacheDir = path.join(ctx.dataDir, 'sources', 'gtadb-http');
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'landmarks.json'), text);
      const { records, notes: n } = parseGtadbLandmarks(json);
      return { revision: sha, snapshot: true, records, leads: [], notes: [...notes, `GitHub HTTP: fetched ${sha.slice(0, 7)}`, ...n] };
    } catch (e) {
      notes.push(`GitHub HTTP failed: ${(e as Error).message}`);
      if (ctx.previousRevision) throw new Error(notes.join(' | '));
      return fromSeed('network sources unavailable on first run');
    }
  },
};
