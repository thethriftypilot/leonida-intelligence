import { distance } from '../../shared/coords.ts';
import { normalizeText } from '../../shared/search.ts';
import type { LocationRecord } from '../../shared/types.ts';

const GENERIC = new Set(['the', 'a', 'of', 'and', 'unnamed', 'location', 'spot']);

export function nameTokens(name: string): Set<string> {
  return new Set(normalizeText(name).replace(/'/g, '').split(' ').filter((t) => t && !GENERIC.has(t)));
}

export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export interface DuplicateMatch {
  match: LocationRecord;
  similarity: number;
  distance: number;
  certain: boolean;
}

/**
 * Find an existing record that a new candidate probably duplicates.
 * certain  – near-identical name within 75 m (safe to skip/merge)
 * possible – similar name within 300 m (needs human review)
 */
export function findDuplicate(
  cand: { name: string; x: number | null; y: number | null; group?: string },
  existing: LocationRecord[],
): DuplicateMatch | null {
  if (cand.x === null || cand.y === null) {
    const exact = existing.find((e) => e.status === 'active' && nameSimilarity(e.name, cand.name) >= 0.95 && (!cand.group || e.group === cand.group));
    return exact ? { match: exact, similarity: 1, distance: NaN, certain: false } : null;
  }
  let best: DuplicateMatch | null = null;
  for (const e of existing) {
    if (e.status !== 'active' || e.x === null || e.y === null) continue;
    const d = distance({ x: cand.x, y: cand.y }, { x: e.x, y: e.y });
    if (d > 300) continue;
    const s = nameSimilarity(cand.name, e.name);
    if (s < 0.6) continue;
    const certain = s >= 0.85 && d <= 75;
    if (!best || s - d / 1000 > best.similarity - best.distance / 1000) best = { match: e, similarity: s, distance: d, certain };
  }
  return best;
}
