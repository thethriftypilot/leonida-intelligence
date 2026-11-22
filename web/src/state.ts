import type { LocationRecord, Progress, Verification } from '../../shared/types.ts';
import { DEFAULT_HIDDEN_CATEGORIES, GROUPS } from '../../shared/categories.ts';
import { isDone } from '../../shared/search.ts';

export interface Filters {
  groups: string[];
  hiddenCats: string[];
  hideCompleted: boolean;
  verifications: Verification[];
  showApprox: boolean;
  onlyFavorites: boolean;
  onlyPlanned: boolean;
  onlyUnvisited: boolean;
  enterableOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  groups: GROUPS.map((g) => g.key),
  hiddenCats: [...DEFAULT_HIDDEN_CATEGORIES],
  hideCompleted: false,
  verifications: ['verified', 'corroborated', 'unconfirmed', 'disputed'],
  showApprox: true,
  onlyFavorites: false,
  onlyPlanned: false,
  onlyUnvisited: false,
  enterableOnly: false,
};

export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveLocal(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export function applyFilters(locs: LocationRecord[], f: Filters, progress: Record<string, Progress>, highlight: Set<string> | null): LocationRecord[] {
  const groups = new Set(f.groups);
  const hidden = new Set(f.hiddenCats);
  const verif = new Set(f.verifications);
  return locs.filter((l) => {
    if (highlight) return highlight.has(l.id);
    if (!groups.has(l.group)) return false;
    if (hidden.has(`${l.group}/${l.category}`)) return false;
    if (!verif.has(l.verification)) return false;
    if (!f.showApprox && (l.precision === 'area' || l.precision === 'approximate')) return false;
    const p = progress[l.id];
    if (f.hideCompleted && isDone(p)) return false;
    if (f.onlyFavorites && !p?.favorite) return false;
    if (f.onlyPlanned && !p?.planned) return false;
    if (f.onlyUnvisited && p?.visited) return false;
    if (f.enterableOnly && !l.enterable) return false;
    return true;
  });
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `in ${Math.round(f / 60)} min`;
    if (f < 86400) return `in ${Math.round(f / 3600)} h`;
    return `in ${Math.round(f / 86400)} d`;
  }
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const VERIFICATION_LABEL: Record<Verification, string> = {
  verified: 'Verified',
  corroborated: 'Community corroborated',
  unconfirmed: 'Unconfirmed',
  disputed: 'Disputed',
  outdated: 'Outdated',
};

export const PRECISION_LABEL: Record<string, string> = {
  marker: 'Exact map marker (from source screenshot)',
  venue: 'Venue position',
  area: 'Approximate area',
  approximate: 'Approximate',
  unknown: 'Position unknown',
};
