// Builds what clients may see: applies the user's verification/position overrides and
// spoiler protection to research records, and derives map metadata (regions, groups, layers).

import fs from 'node:fs';
import path from 'node:path';
import type { WorldRepo } from './worldRepo.ts';
import type { UserRepo } from './userRepo.ts';
import type { GroupInfo, LocationRecord, MapLayerInfo, RegionInfo, SpoilerSettings, WorldMeta } from '../shared/types.ts';
import { GROUPS } from '../shared/categories.ts';
import { redact, spoilerVisibility } from '../shared/spoilers.ts';
import { normalizeText } from '../shared/search.ts';

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class WorldView {
  world: WorldRepo;
  user: UserRepo;
  tilesDir: string;
  private cache: LocationRecord[] | null = null;
  private places: { name: string; key: string; x: number; y: number; weight: number }[] | null = null;

  constructor(world: WorldRepo, user: UserRepo, tilesDir: string) {
    this.world = world;
    this.user = user;
    this.tilesDir = tilesDir;
  }

  invalidate(): void {
    this.cache = null;
    this.places = null;
  }

  /** All active records with user overrides applied (no spoiler filtering). */
  records(): LocationRecord[] {
    if (!this.cache) this.cache = this.world.all();
    const vo = this.user.verificationOverrides();
    const po = this.user.positionOverrides();
    return this.cache.map((r) => {
      let out = r;
      if (vo[r.id]) out = { ...out, verification: vo[r.id].verification, evidence: `${out.evidence ?? ''} Your verdict: ${vo[r.id].verification}${vo[r.id].note ? ` — ${vo[r.id].note}` : ''}.`.trim() };
      if (po[r.id] && out.x === null) out = { ...out, x: po[r.id].x, y: po[r.id].y, precision: 'approximate', evidence: `${out.evidence ?? ''} Position placed by you${po[r.id].note ? ` (${po[r.id].note})` : ''}; not from a source.`.trim(), tags: [...out.tags, 'placed-by-you'] };
      return out;
    });
  }

  /** Records filtered and redacted for a client. Hidden records are omitted entirely. */
  visible(s: SpoilerSettings): { locations: LocationRecord[]; hiddenCount: number } {
    const out: LocationRecord[] = [];
    let hidden = 0;
    const now = Date.now();
    for (const r of this.records()) {
      const v = spoilerVisibility(r, s, now);
      if (v === 'hidden') { hidden++; continue; }
      out.push(v === 'redacted' ? redact(r) : r);
    }
    return { locations: out, hiddenCount: hidden };
  }

  placeIndex(): { name: string; key: string; x: number; y: number; weight: number }[] {
    if (this.places) return this.places;
    const buckets = new Map<string, { name: string; xs: number[]; ys: number[] }>();
    const add = (name: string | null) => (r: LocationRecord) => {
      if (!name || r.x === null || r.y === null) return;
      const key = normalizeText(name);
      if (!key) return;
      const b = buckets.get(key) ?? { name, xs: [], ys: [] };
      b.xs.push(r.x);
      b.ys.push(r.y);
      buckets.set(key, b);
    };
    for (const r of this.records()) {
      if (r.spoiler !== 'none') continue;
      add(r.region)(r);
      add(r.neighborhood)(r);
    }
    this.places = [...buckets.entries()].map(([key, b]) => ({ name: b.name, key, x: median(b.xs), y: median(b.ys), weight: b.xs.length }))
      .sort((a, b) => b.weight - a.weight);
    return this.places;
  }

  resolvePlace(text: string): { name: string; x: number; y: number } | null {
    const t = normalizeText(text);
    if (!t) return null;
    const idx = this.placeIndex();
    const exact = idx.find((p) => p.key === t);
    if (exact) return exact;
    const pre = idx.find((p) => p.key.startsWith(t) || t.startsWith(p.key));
    if (pre && Math.min(pre.key.length, t.length) >= 4) return pre;
    const named = this.records().find((r) => r.spoiler === 'none' && r.x !== null && normalizeText(r.name) === t);
    return named ? { name: named.name, x: named.x!, y: named.y! } : null;
  }

  regions(): RegionInfo[] {
    const counts = new Map<string, { xs: number[]; ys: number[]; name: string }>();
    for (const r of this.records()) {
      if (r.sourceId !== 'gtadb' || !r.region || r.x === null || r.y === null) continue;
      const b = counts.get(r.region) ?? { xs: [], ys: [], name: r.region };
      b.xs.push(r.x);
      b.ys.push(r.y!);
      counts.set(r.region, b);
    }
    return [...counts.values()].filter((b) => b.xs.length >= 5)
      .map((b) => ({ name: b.name, x: median(b.xs), y: median(b.ys), count: b.xs.length }))
      .sort((a, b) => b.count - a.count);
  }

  groups(locs: LocationRecord[]): GroupInfo[] {
    return GROUPS.map((g) => {
      const cats = new Map<string, number>();
      let count = 0;
      for (const r of locs) {
        if (r.group !== g.key) continue;
        count++;
        cats.set(r.category, (cats.get(r.category) ?? 0) + 1);
      }
      return {
        key: g.key, label: g.label, color: g.color, icon: g.icon, count,
        categories: [...cats.entries()].map(([key, n]) => ({ key, label: key, count: n })).sort((a, b) => b.count - a.count),
      };
    });
  }

  layers(): MapLayerInfo[] {
    const has = (dir: string) => fs.existsSync(path.join(this.tilesDir, dir, '0'));
    return [
      { id: 'day', label: 'Game map (day)', url: '/tiles/day/{z}/{z},{y},{x}.jpg', maxNativeZoom: fs.existsSync(path.join(this.tilesDir, 'day', '6')) ? 6 : 5, attribution: 'GTA VI map tiles via <a href="https://map.gtadb.org" target="_blank" rel="noopener">GTADB</a> (CC BY 4.0 declared upstream; artwork provenance not independently confirmed)', installed: has('day'), background: '#2f90b0' },
      { id: 'night', label: 'Game map (night style)', url: '/tiles/day/{z}/{z},{y},{x}.jpg', maxNativeZoom: fs.existsSync(path.join(this.tilesDir, 'day', '6')) ? 6 : 5, attribution: 'GTA VI map tiles via GTADB (CC BY 4.0), recoloured locally', installed: has('day'), background: '#0b1622' },
      { id: 'community', label: 'Community road map (YANIS v18)', url: '/tiles/yanis,18/{z}/{z},{y},{x}.jpg', maxNativeZoom: 5, attribution: 'GTA VI Map Tiles (CC BY 4.0) — YANIS, the GTA VI Mapping Community, <a href="https://map.gtadb.org" target="_blank" rel="noopener">gtadb.org</a> and contributors', installed: has('yanis,18'), background: '#2c67a4' },
    ];
  }

  meta(locs: LocationRecord[]): WorldMeta {
    return { regions: this.regions(), maxChapter: this.world.maxChapter(), groups: this.groups(locs), layers: this.layers() };
  }
}
