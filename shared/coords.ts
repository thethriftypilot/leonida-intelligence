// Coordinate frame helpers.
//
// Canonical frame: GTADB GTA VI game units (≈ metres). Origin (0,0) at the centre of the
// GTADB tile pyramid, x grows east, y grows north. Tile level z has 2^(z+2) tiles of
// 256 px per side covering [-16384, 16384] on both axes (level 5 = 1 px per unit).
// Source: https://github.com/rolux/gtadb.org/blob/main/maps/tiles.py

export const WORLD_HALF = 16384;

/** Plausible extent of Leonida in the canonical frame (with margin). Used to reject bad data. */
export const WORLD_BOUNDS = { minX: -14000, maxX: 8000, minY: -12000, maxY: 14000 };

/**
 * Normalised frame used by the "GTA 6 Loot Map" dataset (MIT) — a crop of the same
 * GTADB grid: x = (gameX + 10240) / 13824, y = (10496 − gameY) / 19456.
 * Verified against GTADB venue coordinates (exact match) during development.
 */
export const LOOT_FRAME = { minX: -10240, maxX: 3584, minY: -8960, maxY: 10496 };

export function lootNormalizedToGame(nx: number, ny: number): { x: number; y: number } {
  return {
    x: LOOT_FRAME.minX + nx * (LOOT_FRAME.maxX - LOOT_FRAME.minX),
    y: LOOT_FRAME.maxY - ny * (LOOT_FRAME.maxY - LOOT_FRAME.minY),
  };
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isValidGameCoord(x: unknown, y: unknown): boolean {
  return (
    isFiniteNumber(x) && isFiniteNumber(y) &&
    x >= WORLD_BOUNDS.minX && x <= WORLD_BOUNDS.maxX &&
    y >= WORLD_BOUNDS.minY && y <= WORLD_BOUNDS.maxY
  );
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}
