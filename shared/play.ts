// Play Mode: a guided hunt that always points you at the nearest unfinished place you can
// actually do right now. Distances are straight lines (no licensed road network exists), and
// only records with a real, sourced position are ever suggested.

import type { LocationRecord, Progress, ProgressFlag } from './types.ts';
import { isDone } from './search.ts';
import { distance } from './coords.ts';

export interface Point { x: number; y: number }

/** Groups that make sense to hunt. Landmarks are places, not goals; glitches have no position. */
export const PLAYABLE_GROUPS = ['collectibles', 'money', 'weapons', 'secrets', 'activities', 'vehicles', 'story', 'services'];

export interface HuntOptions {
  groups: string[];
  from: Point;
  chapter: number;
  skipped?: Set<string>;
  /** Include records whose position is only approximate or an area. */
  includeApprox?: boolean;
}

export function isHuntable(l: LocationRecord, progress: Record<string, Progress>, o: Omit<HuntOptions, 'from'>): boolean {
  if (l.x === null || l.y === null) return false;
  if (!o.groups.includes(l.group)) return false;
  if (l.redacted || l.category === 'Unnamed buildings') return false;
  if (l.verification === 'disputed' || l.verification === 'outdated') return false;
  if (l.chapterMin !== null && l.chapterMin > o.chapter) return false;
  if (!o.includeApprox && (l.precision === 'area' || l.precision === 'unknown')) return false;
  if (o.skipped?.has(l.id)) return false;
  return !isDone(progress[l.id]);
}

/** The huntable places, nearest first. */
export function huntQueue(locations: LocationRecord[], progress: Record<string, Progress>, o: HuntOptions, limit = 5): { loc: LocationRecord; distance: number }[] {
  const out: { loc: LocationRecord; distance: number }[] = [];
  for (const l of locations) {
    if (!isHuntable(l, progress, o)) continue;
    out.push({ loc: l, distance: distance(o.from, { x: l.x!, y: l.y! }) });
  }
  out.sort((a, b) => a.distance - b.distance || a.loc.name.localeCompare(b.loc.name));
  return out.slice(0, limit);
}

/** Which progress flag "Got it" sets: things you pick up are collected, everything else completed. */
export function doneFlagFor(l: LocationRecord): ProgressFlag {
  return l.group === 'collectibles' || l.group === 'money' || l.group === 'weapons' ? 'collected' : 'completed';
}

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Compass direction from a to b. Map x grows east and y grows north. */
export function bearing(a: Point, b: Point): { degrees: number; label: string } {
  const deg = (Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI + 360) % 360;
  return { degrees: deg, label: DIRS[Math.round(deg / 45) % 8] };
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
