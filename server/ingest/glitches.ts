// Glitches & fixes adapter. Reads the project's own curated glitch list
// (seed/glitches/glitches.json): our own summaries and step-by-step tutorials, each with
// a working/patched status, the date it was last checked and links to the articles it is
// based on. Every update run fetches the newest list published on the project's GitHub
// repository, so status changes reach every install without an app update. Entries only get
// a map position when a source names a place that matches a GTADB landmark.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AdapterContext, AdapterResult, SourceAdapter } from './types.ts';
import type { NormalizedRecord } from '../worldRepo.ts';
import { expectOk } from './http.ts';
import type { Precision, SpoilerLevel, Verification } from '../../shared/types.ts';

export const GLITCH_REPO = 'thethriftypilot/leonida-intelligence';
const FILE = 'glitches.json';

export type GlitchStatus = 'working' | 'unconfirmed' | 'patched' | 'workaround' | 'unfixed' | 'fixed' | 'fake';

export const GLITCH_STATUS_LABEL: Record<GlitchStatus, string> = {
  working: 'Working',
  unconfirmed: 'Unconfirmed',
  patched: 'Patched',
  workaround: 'Player fix',
  unfixed: 'Not fixed yet',
  fixed: 'Fixed',
  fake: 'Fake / avoid',
};

interface GlitchSource { label: string; url: string; date?: string }
interface GlitchEntry {
  id: string; kind: string; status: GlitchStatus; name: string; summary: string; statusNote?: string; checkedAt?: string;
  platforms?: string[]; characters?: string | null; requirements?: string | null; reward?: string | null;
  steps?: string[]; risks?: string[]; spoiler?: SpoilerLevel; chapterMin?: number | null; patchedIn?: string;
  location?: { x: number; y: number; precision?: Precision; region?: string; neighborhood?: string; note?: string } | null;
  sources?: GlitchSource[];
}
interface GlitchFile { schemaVersion: number; updatedAt: string; latestGameVersion?: string; entries: GlitchEntry[] }

function categoryOf(e: GlitchEntry): string {
  if (e.kind === 'update') return 'Game updates & patch notes';
  if (e.status === 'fake') return 'Fake glitches & scams';
  if (e.status === 'patched') return 'Patched glitches';
  if (e.kind === 'bug' || e.kind === 'bug-fix') return 'Known bugs & fixes';
  return 'Working glitches';
}

function verificationOf(e: GlitchEntry): Verification {
  const n = new Set((e.sources ?? []).map((s) => new URL(s.url).host)).size;
  if (e.status === 'patched') return 'outdated';
  if (e.status === 'fake') return 'disputed';
  if (e.status === 'unconfirmed') return n >= 2 ? 'corroborated' : 'unconfirmed';
  return n >= 2 ? 'corroborated' : 'unconfirmed';
}

export function statusLine(e: GlitchEntry): string {
  const label = GLITCH_STATUS_LABEL[e.status] ?? e.status;
  const parts = [label];
  if (e.patchedIn) parts.push(`patched in ${e.patchedIn}`);
  if (e.statusNote) parts.push(e.statusNote);
  if (e.checkedAt) parts.push(`Last checked ${e.checkedAt}.`);
  return parts.join(' — ');
}

export function normalizeGlitch(e: GlitchEntry, fileDate: string): NormalizedRecord {
  const loc = e.location && Number.isFinite(e.location.x) && Number.isFinite(e.location.y) ? e.location : null;
  const sources = (e.sources ?? []).filter((s) => s?.url && /^https:\/\//.test(s.url));
  const description = [
    e.summary,
    e.requirements ? `Needs: ${e.requirements}` : '',
    e.risks?.length ? `Watch out: ${e.risks.join(' ')}` : '',
  ].filter(Boolean).join('\n\n');
  return {
    sourceKey: e.id,
    name: e.name,
    group: 'glitches',
    category: categoryOf(e),
    subcategory: GLITCH_STATUS_LABEL[e.status] ?? null,
    tags: ['glitch', `glitch-status:${e.status}`, `glitch-kind:${e.kind}`, ...(e.platforms ?? []).map((p) => `platform:${p}`)],
    description,
    steps: e.steps ?? [],
    x: loc?.x ?? null,
    y: loc?.y ?? null,
    precision: loc ? (loc.precision ?? 'approximate') : 'unknown',
    region: loc?.region ?? null,
    neighborhood: loc?.neighborhood ?? null,
    address: null,
    availability: statusLine(e),
    chapterMin: e.chapterMin ?? null,
    missable: false,
    characters: e.characters ?? null,
    rewards: e.reward ?? null,
    repeatable: e.kind === 'glitch' ? true : null,
    enterable: false,
    media: [],
    sourceUrl: sources[0]?.url ?? null,
    sourceLabel: sources[0]?.label ?? null,
    links: sources.map((s) => ({ label: s.date ? `${s.label} (${s.date})` : s.label, url: s.url })),
    evidence: [
      loc?.note ?? (loc ? '' : 'No map position: this glitch or fix is not tied to one place.'),
      `Summary and steps written for Leonida Intelligence from the linked articles (${sources.length} source${sources.length === 1 ? '' : 's'}). Glitch list dated ${fileDate}.`,
    ].filter(Boolean).join(' '),
    verification: verificationOf(e),
    confidence: Math.min(0.9, 0.4 + 0.15 * sources.length),
    spoiler: e.spoiler ?? 'gameplay',
    relatedId: null,
  };
}

export function parseGlitchFile(json: unknown): { records: NormalizedRecord[]; notes: string[]; updatedAt: string } {
  const f = json as GlitchFile;
  if (!f || f.schemaVersion !== 1 || !Array.isArray(f.entries)) throw new Error('Glitch list: unexpected file format');
  const notes: string[] = [];
  const records: NormalizedRecord[] = [];
  const seen = new Set<string>();
  for (const e of f.entries) {
    if (!e?.id || !e.name || !e.status || seen.has(e.id)) { notes.push(`skipped invalid glitch entry ${e?.id ?? '?'}`); continue; }
    if (!(e.status in GLITCH_STATUS_LABEL)) { notes.push(`skipped ${e.id}: unknown status ${e.status}`); continue; }
    if (!(e.sources ?? []).length) { notes.push(`skipped ${e.id}: no sources`); continue; }
    seen.add(e.id);
    records.push(normalizeGlitch(e, f.updatedAt));
  }
  if (!records.length) throw new Error('Glitch list is empty');
  notes.push(`${records.length} glitch & fix entries (list dated ${f.updatedAt}${f.latestGameVersion ? `, game version ${f.latestGameVersion}` : ''})`);
  return { records, notes, updatedAt: f.updatedAt };
}

const sha = (s: string) => crypto.createHash('sha1').update(s).digest('hex');

export const glitchesAdapter: SourceAdapter = {
  id: 'glitches',
  name: 'Glitches, bugs & patch notes',
  kind: 'dataset',
  description: 'Curated list of current GTA VI glitches, player fixes for bugs and update notes, with step-by-step tutorials, a working/patched status and source links. Refreshed from the project repository on every update run.',
  homepage: `https://github.com/${GLITCH_REPO}/blob/main/seed/glitches/${FILE}`,
  license: 'MIT (project text); linked articles © their publishers',
  attribution: 'Leonida Intelligence glitch notes, summarising and linking articles from GTA6BUGS, games.gg, Pure Xbox, Dexerto, TweakTown, Rockstar Support and others',
  defaultEnabled: true,
  defaultConfig: { url: `https://raw.githubusercontent.com/${GLITCH_REPO}/main/seed/glitches/${FILE}` },

  async run(ctx: AdapterContext): Promise<AdapterResult> {
    const cacheDir = path.join(ctx.dataDir, 'sources', 'glitches');
    const seedFile = path.join(ctx.seedDir, 'glitches', FILE);
    const fromText = (text: string, note: string): AdapterResult => {
      const { records, notes } = parseGlitchFile(JSON.parse(text));
      return { revision: sha(text), snapshot: true, records, leads: [], notes: [note, ...notes] };
    };
    const local = (why: string): AdapterResult => {
      const cached = path.join(cacheDir, FILE);
      // Prefer whichever local copy is newer: the cached download or the copy shipped with the app.
      const candidates = [cached, seedFile].filter((f) => fs.existsSync(f)).map((f) => {
        const text = fs.readFileSync(f, 'utf8');
        return { f, text, date: String((JSON.parse(text) as GlitchFile).updatedAt ?? '') };
      }).sort((a, b) => b.date.localeCompare(a.date));
      if (!candidates.length) throw new Error('no glitch list available');
      return fromText(candidates[0].text, `${why}; using ${candidates[0].f === cached ? 'cached' : 'bundled'} list`);
    };

    if (ctx.offline) return local('Offline mode');
    let text: string;
    try {
      const url = String(ctx.config.url ?? glitchesAdapter.defaultConfig.url);
      const res = await ctx.http(url, { timeoutMs: 30000 });
      expectOk(res, url);
      text = await res.text();
      parseGlitchFile(JSON.parse(text)); // validate before trusting it
    } catch (e) {
      return local(`could not fetch the latest glitch list (${(e as Error).message})`);
    }
    // Never go backwards: a bundled list newer than the published one wins (e.g. before a push).
    const bundled = fs.existsSync(seedFile) ? fs.readFileSync(seedFile, 'utf8') : null;
    if (bundled && String((JSON.parse(bundled) as GlitchFile).updatedAt) > String((JSON.parse(text) as GlitchFile).updatedAt)) {
      return fromText(bundled, 'bundled glitch list is newer than the published one');
    }
    const rev = sha(text);
    if (rev === ctx.previousRevision) return { revision: rev, unchanged: true, snapshot: true, records: [], leads: [], notes: ['glitch list unchanged'] };
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, FILE), text);
    return fromText(text, 'fetched the latest glitch list');
  },
};
