import L from 'leaflet';

/**
 * Leaflet CRS for the GTADB GTA VI frame. lat = game y (north), lng = game x (east).
 * Zoom 0 renders the full 32768-unit square at 1024 px (4×4 tiles of 256 px), matching
 * the GTADB tile pyramid (tiles.py) so tile {z}/{z},{y},{x}.jpg lines up exactly.
 */
export const GTA_CRS: L.CRS = L.extend({}, L.CRS.Simple, {
  transformation: new L.Transformation(1 / 32, 512, -1 / 32, 512),
  // Must stay infinite: Simple's LonLat projection bounds (±180/±90) would otherwise clip the tile grid.
  infinite: true,
});

export const toLatLng = (x: number, y: number): L.LatLngExpression => [y, x];
export const fromLatLng = (ll: L.LatLng): { x: number; y: number } => ({ x: Math.round(ll.lng * 10) / 10, y: Math.round(ll.lat * 10) / 10 });

/** Navigable area: Leonida plus margin (tiles exist roughly −11000…3600 x, −9000…10600 y). */
export const MAX_BOUNDS = L.latLngBounds([-13000, -14000], [13500, 7500]);
export const DEFAULT_VIEW = { center: [800, -3600] as [number, number], zoom: 1 };
