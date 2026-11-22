// Natural-language "Game Intelligence Search" over structured local data.
// Deterministic and offline — no AI service is involved.

import { GROUPS } from './categories.ts';
import { distance } from './coords.ts';
import type { LocationRecord, Progress, SpoilerSettings } from './types.ts';

export interface PlaceResolver {
  (text: string): { name: string; x: number; y: number } | null;
}

export interface ParsedQuery {
  raw: string;
  groups: string[];
  terms: string[];
  near: { name: string; x: number; y: number } | null;
  incomplete: boolean;
  accessibleNow: boolean;
  early: boolean;
  free: boolean;
  beforeNextChapter: boolean;
  favorites: boolean;
  planned: boolean;
  interpretation: string[];
}

const STOP = new Set(
  ('where can i get a an the me show find some to in of for what which is are do does should my any with and or on at ' +
    'game location locations places place there that have has been yet all right now near nearby around close by ' +
    'havent haven not discovered missing before moving next chapter access ive it from up go see list give tell about ' +
    'good best how lot lots get got i\'m im you your one ones things thing stuff spot spots onto into this those these ' +
    'early free available accessible currently current point find found undiscovered remaining left still need ' +
    'missable things anything something stuff moving progressing advancing leaving').split(/\s+/),
);

// Words that only select a group and need not literally match the record text.
const GENERIC_GROUP_WORDS = new Set([
  'weapon', 'weapons', 'gun', 'guns', 'money', 'cash', 'vehicle', 'vehicles', 'car', 'cars', 'secret', 'secrets',
  'hidden', 'collectible', 'collectibles', 'activity', 'activities', 'shop', 'shops', 'store', 'stores', 'mission',
  'missions', 'story', 'landmark', 'landmarks', 'service', 'services', 'equipment', 'loot', 'rare', 'exotic',
  'robbery', 'robberies', 'easter', 'egg', 'eggs', 'business',
]);

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9$%'\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseQuery(raw: string, resolvePlace?: PlaceResolver): ParsedQuery {
  const text = normalizeText(raw);
  const interpretation: string[] = [];
  let near: ParsedQuery['near'] = null;
  let working = ` ${text} `;

  if (resolvePlace) {
    const m = working.match(/\b(?:near|around|close to|by|in|at)\s+([a-z0-9' .-]+?)(?=\s+(?:that|which|i|right|now|where|for|with)\b|\s*$)/);
    if (m) {
      const place = resolvePlace(m[1].trim());
      if (place) {
        near = place;
        working = working.replace(m[0], ' ');
        interpretation.push(`near ${place.name}`);
      }
    }
  }

  const incomplete = /\b(haven'?t|have not|not (yet )?(found|discovered|done|completed|collected|visited)|missing|undiscovered|remaining|left to|still need|uncollected|incomplete)\b/.test(text);
  const accessibleNow = /\b(right now|now|can access|accessible|available|current chapter|at this point|so far)\b/.test(text);
  const early = /\b(early|first|start|beginning|prologue)\b/.test(text);
  const free = /\bfree\b/.test(text);
  const beforeNextChapter = /\b(before (moving|going|advancing|heading|progressing|leaving)|missable|miss out|before the next chapter|before next chapter)\b/.test(text);
  const favorites = /\b(favou?rites?|starred)\b/.test(text);
  const planned = /\b(planned|saved for later|to ?do list|later)\b/.test(text);

  const tokens = working.split(' ').filter(Boolean);
  const groups = new Set<string>();
  for (const t of tokens) {
    for (const g of GROUPS) if (g.keywords.includes(t)) groups.add(g.key);
  }
  if (/\bhidden cash\b/.test(text)) groups.add('money');
  if (/\bmissions?\b/.test(text)) groups.add('story');

  const terms = tokens.filter((t) => t.length > 1 && !STOP.has(t) && !GENERIC_GROUP_WORDS.has(t));

  if (groups.size) interpretation.unshift(`categories: ${[...groups].map((g) => GROUPS.find((x) => x.key === g)?.label ?? g).join(', ')}`);
  if (incomplete) interpretation.push('not yet completed by you');
  if (accessibleNow || early) interpretation.push('accessible at your current chapter');
  if (free) interpretation.push('"free" matched against source wording only');
  if (beforeNextChapter) interpretation.push('missable / current-chapter items');
  if (favorites) interpretation.push('favourites');
  if (planned) interpretation.push('planned');
  if (terms.length) interpretation.push(`keywords: ${terms.join(', ')}`);

  return { raw, groups: [...groups], terms, near, incomplete, accessibleNow: accessibleNow || early, early, free, beforeNextChapter, favorites, planned, interpretation };
}

export function isDone(p: Progress | undefined): boolean {
  return !!p && (p.completed || p.collected);
}

export interface SearchHit {
  loc: LocationRecord;
  score: number;
  distance: number | null;
}

function haystack(loc: LocationRecord): { name: string; meta: string; body: string } {
  return {
    name: normalizeText(loc.name),
    meta: normalizeText(`${loc.category} ${loc.subcategory ?? ''} ${loc.region ?? ''} ${loc.neighborhood ?? ''} ${loc.tags.join(' ')}`),
    body: normalizeText(`${loc.description ?? ''} ${loc.steps.join(' ')} ${loc.rewards ?? ''} ${loc.address ?? ''}`),
  };
}

export function searchLocations(
  locs: LocationRecord[],
  q: ParsedQuery,
  progress: Record<string, Progress>,
  spoilers: SpoilerSettings,
  limit = 100,
): { hits: SearchHit[]; fallback: boolean } {
  const run = (useTerms: boolean): SearchHit[] => {
    const hits: SearchHit[] = [];
    for (const loc of locs) {
      if (loc.status !== 'active') continue;
      if (q.groups.length && !q.groups.includes(loc.group)) continue;
      const p = progress[loc.id];
      if (q.incomplete && isDone(p)) continue;
      if (q.favorites && !p?.favorite) continue;
      if (q.planned && !p?.planned) continue;
      if (q.accessibleNow && loc.chapterMin !== null && loc.chapterMin > spoilers.chapter) continue;
      if (q.beforeNextChapter && !(loc.missable || loc.chapterMin === spoilers.chapter)) continue;
      if (q.near && (loc.x === null || loc.y === null)) continue;

      let score = 1;
      if (useTerms && q.terms.length) {
        const h = haystack(loc);
        let matched = 0;
        for (const t of q.terms) {
          let s = 0;
          if (h.name.includes(t)) s = h.name.split(' ').includes(t) ? 6 : 4;
          else if (h.meta.includes(t)) s = 3;
          else if (h.body.includes(t)) s = 1;
          if (s) matched++;
          score += s;
        }
        if (!matched) continue;
        score += matched * 2;
      }
      if (q.free && /\bfree\b|no cost|pick ?up/i.test(`${loc.description} ${loc.steps.join(' ')}`)) score += 3;
      if (q.early) score += loc.chapterMin === null ? 0 : Math.max(0, 3 - loc.chapterMin);
      if (loc.verification === 'verified') score += 2;
      else if (loc.verification === 'corroborated') score += 1;
      else if (loc.verification === 'disputed' || loc.verification === 'outdated') score -= 2;
      if (loc.category === 'Unnamed buildings') score -= 3;

      let d: number | null = null;
      if (q.near && loc.x !== null && loc.y !== null) {
        d = distance(q.near, { x: loc.x, y: loc.y });
        score += Math.max(0, 6 - d / 500);
      }
      hits.push({ loc, score, distance: d });
    }
    hits.sort((a, b) => b.score - a.score || (a.distance ?? 0) - (b.distance ?? 0) || a.loc.name.localeCompare(b.loc.name));
    return hits;
  };

  let hits = run(true);
  let fallback = false;
  if (!hits.length && q.terms.length && q.groups.length) {
    hits = run(false);
    fallback = true;
  }
  return { hits: hits.slice(0, limit), fallback };
}

// ---------------------------------------------------------------------------
// "What should I get first?" — subjective recommendations, kept separate from facts.

const GROUP_WEIGHT: Record<string, number> = {
  weapons: 3, money: 3, vehicles: 2, collectibles: 1.5, services: 1, activities: 1, story: 2, secrets: 1.5, landmarks: 0,
};

export interface Recommendation {
  loc: LocationRecord;
  score: number;
  reasons: string[];
}

export function parseRewardDollars(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/GTA\$\s?([\d,]+)(?:\s*[–-]\s*([\d,]+))?/);
  if (!m) return null;
  const a = Number(m[1].replace(/,/g, ''));
  const b = m[2] ? Number(m[2].replace(/,/g, '')) : a;
  return Number.isFinite(a) ? (a + b) / 2 : null;
}

export function recommend(
  locs: LocationRecord[],
  progress: Record<string, Progress>,
  spoilers: SpoilerSettings,
  limit = 12,
): Recommendation[] {
  const out: Recommendation[] = [];
  for (const loc of locs) {
    if (loc.status !== 'active' || loc.redacted) continue;
    const w = GROUP_WEIGHT[loc.group] ?? 0;
    if (!w) continue;
    if (isDone(progress[loc.id])) continue;
    if (loc.chapterMin !== null && loc.chapterMin > spoilers.chapter) continue;
    if (loc.verification === 'disputed' || loc.verification === 'outdated') continue;
    const reasons: string[] = [];
    let score = w;
    if (loc.chapterMin !== null) {
      score += 2;
      reasons.push(`Available by ${loc.chapterMin === 0 ? 'the Prologue' : `Chapter ${loc.chapterMin}`}`);
    } else {
      reasons.push('Chapter requirement unknown');
    }
    if (loc.missable) {
      score += 2.5;
      reasons.push('Source wording suggests it can be missed');
    }
    const dollars = parseRewardDollars(`${loc.description ?? ''} ${loc.rewards ?? ''}`);
    if (dollars) {
      score += Math.min(3, Math.log10(dollars) - 2);
      reasons.push(`Reported reward ≈ GTA$${Math.round(dollars).toLocaleString('en-US')}`);
    }
    if (loc.verification === 'verified' || loc.verification === 'corroborated') {
      score += 1;
      reasons.push(`Location ${loc.verification}`);
    }
    if (loc.precision === 'area' || loc.precision === 'approximate') score -= 0.5;
    if (loc.group === 'story' && loc.chapterMin !== spoilers.chapter) score -= 1.5;
    out.push({ loc, score, reasons });
  }
  out.sort((a, b) => b.score - a.score || a.loc.name.localeCompare(b.loc.name));
  return out.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Straight-line route ordering (nearest neighbour + 2-opt). No road routing data exists.

export interface RoutePoint { id: string; x: number; y: number }

export function orderRoute(start: { x: number; y: number } | null, pts: RoutePoint[]): { order: RoutePoint[]; legs: number[]; total: number } {
  if (!pts.length) return { order: [], legs: [], total: 0 };
  const remaining = [...pts];
  const order: RoutePoint[] = [];
  let cur: { x: number; y: number } = start ?? remaining[0];
  if (!start) order.push(remaining.shift()!);
  while (remaining.length) {
    let bi = 0;
    let bd = Infinity;
    remaining.forEach((p, i) => {
      const d = distance(cur, p);
      if (d < bd) { bd = d; bi = i; }
    });
    cur = remaining.splice(bi, 1)[0];
    order.push(cur as RoutePoint);
  }
  const pathLen = (o: RoutePoint[]) => {
    let t = 0;
    let prev: { x: number; y: number } | null = start;
    for (const p of o) { if (prev) t += distance(prev, p); prev = p; }
    return t;
  };
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const cand = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        if (pathLen(cand) + 1e-6 < pathLen(order)) { order.splice(0, order.length, ...cand); improved = true; }
      }
    }
  }
  const legs: number[] = [];
  let prev: { x: number; y: number } | null = start;
  for (const p of order) { legs.push(prev ? distance(prev, p) : 0); prev = p; }
  return { order, legs, total: legs.reduce((a, b) => a + b, 0) };
}
