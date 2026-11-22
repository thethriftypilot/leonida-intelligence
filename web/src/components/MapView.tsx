import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import type { CustomMarker, LocationRecord, MapLayerInfo, Progress } from '../../../shared/types.ts';
import { GTA_CRS, MAX_BOUNDS, DEFAULT_VIEW, toLatLng, fromLatLng } from '../mapUtil.ts';
import { iconSvg, STAR_SVG, CHECK_SVG } from '../icons.tsx';
import { GROUP_BY_KEY } from '../../../shared/categories.ts';
import { formatDistance, distance } from '../../../shared/coords.ts';
import { isDone } from '../../../shared/search.ts';

export type MapMode = 'none' | 'pick' | 'measure';

export interface FlyRequest { x: number; y: number; zoom?: number; nonce: number }

interface Props {
  layer: MapLayerInfo | null;
  locations: LocationRecord[];
  progress: Record<string, Progress>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  markers: CustomMarker[];
  onMarkerClick: (id: string) => void;
  myPosition: { x: number; y: number } | null;
  route: { start: { x: number; y: number } | null; points: { x: number; y: number; name: string }[] } | null;
  mode: MapMode;
  onPick: (p: { x: number; y: number }) => void;
  fly: FlyRequest | null;
  onReady?: (map: L.Map) => void;
}

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function pinKey(l: LocationRecord, p: Progress | undefined, selected: boolean): string {
  return [l.group, l.verification, l.precision, l.category === 'Unnamed buildings' ? 'dot' : 'pin', isDone(p) ? 'd' : '', p?.visited ? 'v' : '', p?.favorite ? 'f' : '', p?.planned ? 'p' : '', selected ? 's' : '', l.redacted ? 'r' : ''].join('|');
}

function pinIcon(l: LocationRecord, p: Progress | undefined, selected: boolean): L.DivIcon {
  const color = GROUP_BY_KEY[l.group]?.color ?? '#999';
  if (l.category === 'Unnamed buildings') {
    return L.divIcon({ className: 'li-dot-wrap', html: `<div class="li-dot${selected ? ' sel' : ''}" style="--c:${color}"></div>`, iconSize: [10, 10], iconAnchor: [5, 5] });
  }
  const uncertain = l.verification === 'unconfirmed' || l.verification === 'disputed' || l.verification === 'outdated';
  const cls = [
    'li-pin', `v-${l.verification}`, uncertain ? 'uncertain' : 'confirmed', l.precision === 'area' || l.precision === 'approximate' ? 'approx' : '',
    isDone(p) ? 'done' : '', p?.visited ? 'visited' : '', selected ? 'sel' : '', l.redacted ? 'redacted' : '',
  ].filter(Boolean).join(' ');
  const badge = isDone(p) ? `<span class="li-badge done">${CHECK_SVG}</span>` : p?.favorite ? `<span class="li-badge fav">${STAR_SVG}</span>` : p?.planned ? '<span class="li-badge plan"></span>' : '';
  return L.divIcon({
    className: 'li-pin-wrap',
    html: `<div class="${cls}" style="--c:${color}">${iconSvg(l.group, 14)}${badge}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

type LMarker = L.Marker & { options: L.MarkerOptions & { liGroup?: string; liKey?: string } };

export function MapView(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markerMap = useRef(new Map<string, LMarker>());
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const routeRef = useRef<L.LayerGroup | null>(null);
  const measureRef = useRef<{ group: L.LayerGroup; pts: L.LatLng[] } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // ---------------------------------------------------------------- init
  useEffect(() => {
    if (!el.current) return;
    let saved: { x: number; y: number; zoom: number } | null = null;
    try { saved = JSON.parse(localStorage.getItem('li.view') ?? 'null'); } catch { /* ignore */ }
    const map = L.map(el.current, {
      crs: GTA_CRS, minZoom: 0, maxZoom: 8, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 100,
      maxBounds: MAX_BOUNDS, maxBoundsViscosity: 0.7, zoomControl: false, attributionControl: true, keyboard: true,
      center: saved ? toLatLng(saved.x, saved.y) : DEFAULT_VIEW.center, zoom: saved?.zoom ?? DEFAULT_VIEW.zoom,
    });
    map.attributionControl.setPrefix('Unofficial fan tool · not affiliated with Rockstar Games');
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 140 }).addTo(map);

    const coords = new (L.Control.extend({
      onAdd() {
        const d = L.DomUtil.create('div', 'li-coords');
        d.textContent = 'x —  y —';
        map.on('mousemove', (e: L.LeafletMouseEvent) => {
          const p = fromLatLng(e.latlng);
          d.textContent = `x ${p.x.toFixed(0)}  y ${p.y.toFixed(0)}`;
        });
        return d;
      },
    }))({ position: 'bottomleft' });
    coords.addTo(map);

    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 5,
      maxClusterRadius: (z: number) => (z < 2 ? 55 : z < 4 ? 42 : 30),
      iconCreateFunction(c) {
        const kids = c.getAllChildMarkers() as LMarker[];
        const counts = new Map<string, number>();
        for (const k of kids) counts.set(k.options.liGroup ?? '', (counts.get(k.options.liGroup ?? '') ?? 0) + 1);
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
        const color = GROUP_BY_KEY[top]?.color ?? '#9aa4b8';
        const n = c.getChildCount();
        const size = n < 10 ? 30 : n < 100 ? 36 : 44;
        return L.divIcon({ className: 'li-cluster-wrap', html: `<div class="li-cluster" style="--c:${color};width:${size}px;height:${size}px"><span>${n}</span></div>`, iconSize: [size, size] });
      },
    });
    map.addLayer(cluster);
    clusterRef.current = cluster;
    overlayRef.current = L.layerGroup().addTo(map);
    routeRef.current = L.layerGroup().addTo(map);

    map.on('moveend', () => {
      const c = fromLatLng(map.getCenter());
      try { localStorage.setItem('li.view', JSON.stringify({ ...c, zoom: map.getZoom() })); } catch { /* ignore */ }
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      const p = propsRef.current;
      if (p.mode === 'pick') p.onPick(fromLatLng(e.latlng));
      else if (p.mode === 'measure' && measureRef.current) {
        measureRef.current.pts.push(e.latlng);
        drawMeasure();
      }
    });

    function drawMeasure() {
      const m = measureRef.current;
      if (!m) return;
      m.group.clearLayers();
      if (!m.pts.length) return;
      L.polyline(m.pts, { color: '#ffe066', weight: 3, dashArray: '6 6' }).addTo(m.group);
      let total = 0;
      m.pts.forEach((pt, i) => {
        if (i) total += distance(fromLatLng(m.pts[i - 1]), fromLatLng(pt));
        L.circleMarker(pt, { radius: 4, color: '#ffe066', fillColor: '#120a1f', fillOpacity: 1, weight: 2 })
          .bindTooltip(i ? formatDistance(total) : 'start', { permanent: i === m.pts.length - 1 || i === 0, direction: 'right', className: 'li-measure-tip' })
          .addTo(m.group);
      });
    }

    // Keep Leaflet's size in sync when side panels open/close or the window resizes.
    const ro = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    ro.observe(el.current);

    mapRef.current = map;
    props.onReady?.(map);
    (window as unknown as { __liMap?: L.Map }).__liMap = map;
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; markerMap.current.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- tile layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileRef.current?.remove();
    tileRef.current = null;
    el.current?.classList.toggle('night', props.layer?.id === 'night');
    if (!props.layer || !props.layer.installed) {
      el.current?.style.setProperty('background', '#0b1622');
      return;
    }
    el.current?.style.setProperty('background', props.layer.background);
    const t = L.tileLayer(props.layer.url, {
      minZoom: 0, maxZoom: 8, maxNativeZoom: props.layer.maxNativeZoom, tileSize: 256, noWrap: true,
      errorTileUrl: BLANK, attribution: props.layer.attribution, keepBuffer: 4, className: 'li-tiles',
    });
    t.addTo(map);
    t.bringToBack();
    tileRef.current = t;
  }, [props.layer]);

  // ---------------------------------------------------------------- location markers (diffed)
  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;
    const want = new Map<string, LocationRecord>();
    for (const l of props.locations) if (l.x !== null && l.y !== null) want.set(l.id, l);
    const toRemove: L.Layer[] = [];
    for (const [id, m] of markerMap.current) {
      if (!want.has(id)) { toRemove.push(m); markerMap.current.delete(id); }
    }
    if (toRemove.length) cluster.removeLayers(toRemove);
    const toAdd: L.Layer[] = [];
    for (const [id, l] of want) {
      const p = props.progress[id];
      const key = pinKey(l, p, id === props.selectedId) + `|${l.x},${l.y}|${l.name}`;
      const existing = markerMap.current.get(id);
      if (existing) {
        if (existing.options.liKey !== key) {
          existing.setIcon(pinIcon(l, p, id === props.selectedId));
          existing.setLatLng(toLatLng(l.x!, l.y!));
          existing.setTooltipContent(l.name);
          existing.options.liKey = key;
          existing.setZIndexOffset(id === props.selectedId ? 1000 : 0);
        }
        continue;
      }
      const m = L.marker(toLatLng(l.x!, l.y!), { icon: pinIcon(l, p, id === props.selectedId), keyboard: false, riseOnHover: true, title: '' }) as LMarker;
      m.options.liGroup = l.group;
      m.options.liKey = key;
      m.bindTooltip(l.name, { direction: 'top', offset: [0, -12], className: 'li-tip' });
      m.on('click', () => propsRef.current.onSelect(id));
      (m as unknown as { liId: string }).liId = id;
      markerMap.current.set(id, m);
      toAdd.push(m);
    }
    if (toAdd.length) cluster.addLayers(toAdd);
  }, [props.locations, props.progress, props.selectedId]);

  // ---------------------------------------------------------------- personal overlays
  useEffect(() => {
    const g = overlayRef.current;
    if (!g) return;
    g.clearLayers();
    for (const m of props.markers) {
      L.marker(toLatLng(m.x, m.y), {
        icon: L.divIcon({ className: 'li-pin-wrap', html: `<div class="li-pin personal" style="--c:${m.color}">${iconSvg('personal', 14)}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        zIndexOffset: 500,
      }).bindTooltip(`${m.name} (your marker)`, { direction: 'top', offset: [0, -12], className: 'li-tip' })
        .on('click', () => propsRef.current.onMarkerClick(m.id)).addTo(g);
    }
    if (props.myPosition) {
      L.marker(toLatLng(props.myPosition.x, props.myPosition.y), {
        icon: L.divIcon({ className: 'li-me-wrap', html: '<div class="li-me"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
        interactive: false, zIndexOffset: 2000,
      }).addTo(g);
    }
  }, [props.markers, props.myPosition]);

  useEffect(() => {
    const g = routeRef.current;
    if (!g) return;
    g.clearLayers();
    const r = props.route;
    if (!r || !r.points.length) return;
    const pts = [...(r.start ? [r.start] : []), ...r.points].map((p) => toLatLng(p.x, p.y));
    L.polyline(pts, { color: '#ff5fa2', weight: 4, opacity: 0.9, dashArray: '10 8' }).addTo(g);
    r.points.forEach((p, i) => {
      L.marker(toLatLng(p.x, p.y), {
        icon: L.divIcon({ className: 'li-wp-wrap', html: `<div class="li-wp"><span>${i + 1}</span></div>`, iconSize: [22, 22], iconAnchor: [11, 30] }),
        interactive: false, zIndexOffset: 1500,
      }).addTo(g);
    });
  }, [props.route]);

  // ---------------------------------------------------------------- modes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    el.current?.classList.toggle('picking', props.mode === 'pick' || props.mode === 'measure');
    if (props.mode === 'measure') {
      if (!measureRef.current) measureRef.current = { group: L.layerGroup().addTo(map), pts: [] };
      map.doubleClickZoom.disable();
    } else {
      measureRef.current?.group.remove();
      measureRef.current = null;
      map.doubleClickZoom.enable();
    }
  }, [props.mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.fly) return;
    const z = props.fly.zoom ?? Math.max(map.getZoom(), 4);
    const target = toLatLng(props.fly.x, props.fly.y);
    // Wait a frame so a panel that just opened has resized the map first.
    requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
      const size = map.getSize();
      // On narrow screens the details sheet covers the lower ~60% of the map: aim above it.
      const sheetOpen = size.x <= 900 && !!document.querySelector('.li-right');
      const centre = sheetOpen ? map.unproject(map.project(target, z).add([0, size.y * 0.3]), z) : target;
      map.flyTo(centre, z, { duration: 0.8 });
    });
  }, [props.fly]);

  return <div ref={el} className="li-map" data-testid="map" aria-label="Interactive map of Leonida" />;
}
