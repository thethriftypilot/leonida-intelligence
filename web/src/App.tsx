import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CustomMarker, LocationRecord, Progress, WorldMeta } from '../../shared/types.ts';
import { api, ApiError, setRevealProvider, type Settings, type Stats } from './api.ts';
import { MapView, type FlyRequest, type MapMode } from './components/MapView.tsx';
import { TopBar } from './components/TopBar.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { DetailPanel } from './components/DetailPanel.tsx';
import { ToolsPanel, type ToolId } from './components/ToolsPanel.tsx';
import { BottomBar } from './components/BottomBar.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { Login } from './components/Login.tsx';
import { Toasts, type Toast } from './components/Toasts.tsx';
import { applyFilters, DEFAULT_FILTERS, loadLocal, saveLocal, type Filters } from './state.ts';
import { isDone } from '../../shared/search.ts';

export type PickPurpose =
  | { kind: 'myPosition' }
  | { kind: 'newMarker' }
  | { kind: 'placeItem'; id: string }
  | { kind: 'reviewApprove'; reviewId: number; title: string; group: string | null }
  | { kind: 'routeStart' };

export interface AppApi {
  select: (id: string | null, fly?: boolean) => void;
  flyTo: (x: number, y: number, zoom?: number) => void;
  setProgress: (id: string, patch: Partial<Progress>) => Promise<void>;
  toast: (text: string, kind?: Toast['kind']) => void;
  reload: () => Promise<void>;
  openTool: (t: ToolId | null) => void;
  startPick: (p: PickPurpose) => void;
  setHighlight: (ids: string[] | null, label?: string) => void;
}

const REVEAL_KEY = 'li.revealUntil';
const readReveal = () => {
  try { return Number(sessionStorage.getItem(REVEAL_KEY) ?? 0); } catch { return 0; }
};

export default function App() {
  const [auth, setAuth] = useState<'checking' | 'ok' | 'pin'>('checking');
  const [meta, setMeta] = useState<WorldMeta | null>(null);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [progress, setProgressMap] = useState<Record<string, Progress>>({});
  const [markers, setMarkers] = useState<CustomMarker[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<Filters>(() => loadLocal('li.filters', DEFAULT_FILTERS));
  const [layerId, setLayerId] = useState<string>(() => loadLocal('li.prefs', { layer: 'day' }).layer);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [fly, setFly] = useState<FlyRequest | null>(null);
  const [mode, setMode] = useState<MapMode>('none');
  const [pick, setPick] = useState<PickPurpose | null>(null);
  const [highlight, setHighlightState] = useState<{ ids: Set<string>; label: string } | null>(null);
  const [route, setRoute] = useState<{ start: { x: number; y: number } | null; ids: string[] }>(() => loadLocal('li.route', { start: null, ids: [] as string[] }));
  const [revealUntil, setRevealUntil] = useState<number>(readReveal);
  const [updating, setUpdating] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 900);
  const toastId = useRef(0);

  const revealActive = revealUntil > Date.now();
  setRevealProvider(() => readReveal() > Date.now());

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 5000);
  }, []);

  const setFilters = useCallback((f: Filters) => {
    setFiltersState(f);
    saveLocal('li.filters', f);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [m, l, p, mk, s, st] = await Promise.all([api.meta(), api.locations(), api.progress(), api.markers(), api.settings(), api.stats()]);
      setMeta(m);
      setLocations(l.locations);
      setHiddenCount(l.hiddenCount);
      setProgressMap(p);
      setMarkers(mk);
      setSettings(s);
      setStats(st);
      setUpdating(st.updating);
      setLoadError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setAuth('pin'); return; }
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api.session().then((s) => setAuth(s.authenticated ? 'ok' : 'pin')).catch((e) => { setAuth('ok'); setLoadError((e as Error).message); });
  }, []);
  useEffect(() => { if (auth === 'ok') void reload(); }, [auth, reload]);

  // Re-fetch when the reveal window opens or closes.
  useEffect(() => {
    if (auth !== 'ok') return;
    void reload();
    if (!revealActive) return;
    const t = setTimeout(() => { try { sessionStorage.removeItem(REVEAL_KEY); } catch { /* ignore */ } setRevealUntil(0); }, revealUntil - Date.now());
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealUntil]);

  // Poll while a research update is running, then refresh everything.
  useEffect(() => {
    if (!updating) return;
    const t = setInterval(async () => {
      try {
        const u = await api.updates();
        if (!u.running) {
          setUpdating(false);
          const last = u.runs[0];
          if (last) toast(`Update ${last.status === 'ok' ? 'complete' : last.status === 'partial' ? 'partly failed' : 'failed'}: ${last.summary}`, last.status === 'ok' ? 'success' : 'error');
          await reload();
        }
      } catch { /* keep polling */ }
    }, 2500);
    return () => clearInterval(t);
  }, [updating, reload, toast]);

  // Background refresh every 2 minutes so other devices' changes appear.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      api.progress().then(setProgressMap).catch(() => undefined);
      api.markers().then(setMarkers).catch(() => undefined);
    }, 120_000);
    return () => clearInterval(t);
  }, []);

  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const filtered = useMemo(() => applyFilters(locations, filters, progress, highlight?.ids ?? null), [locations, filters, progress, highlight]);
  const layer = meta?.layers.find((l) => l.id === layerId && l.installed) ?? meta?.layers.find((l) => l.installed) ?? null;

  const flyTo = useCallback((x: number, y: number, zoom?: number) => setFly({ x, y, zoom, nonce: Date.now() }), []);
  const select = useCallback((id: string | null, doFly = false) => {
    setSelectedId(id);
    setSelectedMarkerId(null);
    if (id && doFly) {
      const l = byId.get(id);
      if (l && l.x !== null && l.y !== null) flyTo(l.x, l.y, 5.5);
    }
  }, [byId, flyTo]);

  const setProgress = useCallback(async (id: string, patch: Partial<Progress>) => {
    try {
      const p = await api.setProgress(id, patch);
      setProgressMap((m) => ({ ...m, [id]: p }));
      api.stats().then(setStats).catch(() => undefined);
    } catch (e) {
      toast(`Could not save progress: ${(e as Error).message}`, 'error');
    }
  }, [toast]);

  const startPick = useCallback((p: PickPurpose) => {
    setPick(p);
    setMode('pick');
  }, []);

  const onPick = useCallback(async (pt: { x: number; y: number }) => {
    const p = pick;
    setMode('none');
    setPick(null);
    if (!p) return;
    try {
      if (p.kind === 'myPosition') {
        const s = await api.saveSettings({ myPosition: pt });
        setSettings(s);
        setTool('nearby');
        toast('Your approximate position is set.', 'success');
      } else if (p.kind === 'newMarker') {
        const name = window.prompt('Name for your marker:', 'My marker');
        if (!name) return;
        const m = await api.saveMarker({ name, x: pt.x, y: pt.y });
        setMarkers((ms) => [...ms, m]);
        setSelectedMarkerId(m.id);
        setSelectedId(null);
        toast('Marker added.', 'success');
      } else if (p.kind === 'placeItem') {
        await api.setPosition(p.id, pt.x, pt.y);
        await reload();
        setSelectedId(p.id);
        toast('Position saved as your own placement (marked as not from a source).', 'success');
      } else if (p.kind === 'reviewApprove') {
        const r = await api.resolveReview(p.reviewId, { action: 'approve', x: pt.x, y: pt.y, name: p.title, group: p.group ?? undefined });
        await reload();
        if (r.locationId) setSelectedId(r.locationId);
        toast('Lead added to the map as an unconfirmed location.', 'success');
      } else if (p.kind === 'routeStart') {
        setRoute((r) => { const n = { ...r, start: pt }; saveLocal('li.route', n); return n; });
        setTool('planner');
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }, [pick, reload, toast]);

  const setHighlight = useCallback((ids: string[] | null, label = 'Search results') => {
    setHighlightState(ids ? { ids: new Set(ids), label } : null);
  }, []);

  const runUpdate = useCallback(async () => {
    try {
      await api.runUpdate();
      setUpdating(true);
      toast('Checking sources for new discoveries…');
    } catch (e) {
      toast(`Could not start update: ${(e as Error).message}`, 'error');
    }
  }, [toast]);

  const surprise = useCallback(() => {
    const ch = settings?.spoilers.chapter ?? 0;
    const pool = filtered.filter((l) => l.x !== null && l.group !== 'landmarks' && !l.redacted && !isDone(progress[l.id]) && (l.chapterMin === null || l.chapterMin <= ch) && l.verification !== 'disputed');
    const fallback = filtered.filter((l) => l.x !== null && !isDone(progress[l.id]) && l.category !== 'Unnamed buildings' && !l.redacted);
    const from = pool.length ? pool : fallback;
    if (!from.length) { toast('Nothing left to surprise you with under the current filters.'); return; }
    const pickL = from[Math.floor(Math.random() * from.length)];
    select(pickL.id, true);
    toast(`Surprise: ${pickL.name}`);
  }, [filtered, progress, settings, select, toast]);

  const appApi: AppApi = useMemo(() => ({
    select, flyTo, setProgress, toast, reload, openTool: setTool, startPick, setHighlight,
  }), [select, flyTo, setProgress, toast, reload, startPick, setHighlight]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === '/') { e.preventDefault(); document.getElementById('li-search')?.focus(); }
      else if (e.key === 'Escape') { if (mode !== 'none') { setMode('none'); setPick(null); } else if (selectedId) setSelectedId(null); else setTool(null); }
      else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, selectedId]);

  const routePoints = useMemo(() => ({
    start: route.start,
    points: route.ids.map((id) => byId.get(id)).filter((l): l is LocationRecord => !!l && l.x !== null).map((l) => ({ x: l.x!, y: l.y!, name: l.name })),
  }), [route, byId]);

  if (auth === 'checking') return <div className="li-splash"><div className="li-spinner" /> Connecting…</div>;
  if (auth === 'pin') return <Login onDone={() => setAuth('ok')} />;

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const selectedMarker = selectedMarkerId ? markers.find((m) => m.id === selectedMarkerId) ?? null : null;
  const rightOpen = !!(selected || selectedMarker || tool);

  return (
    <div className={`li-app ${leftOpen ? 'left-open' : ''} ${rightOpen ? 'right-open' : ''}`}>
      <TopBar
        meta={meta} settings={settings} stats={stats} updating={updating} revealActive={revealActive} revealUntil={revealUntil}
        hiddenCount={hiddenCount} app={appApi} locations={locations}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onSettings={async (patch) => {
          try { const s = await api.saveSettings(patch); setSettings(s); await reload(); } catch (e) { toast((e as Error).message, 'error'); }
        }}
        onReveal={(minutes) => {
          const until = minutes ? Date.now() + minutes * 60_000 : 0;
          try { if (until) sessionStorage.setItem(REVEAL_KEY, String(until)); else sessionStorage.removeItem(REVEAL_KEY); } catch { /* ignore */ }
          setRevealUntil(until);
        }}
        onUpdate={runUpdate} onDashboard={() => setShowDashboard(true)} onSurprise={surprise}
        onFullscreen={toggleFullscreen}
      />
      {revealActive && (
        <div className="li-reveal-banner" role="status">
          Spoilers temporarily revealed on this device. <button onClick={() => { try { sessionStorage.removeItem(REVEAL_KEY); } catch { /* ignore */ } setRevealUntil(0); }}>Hide spoilers now</button>
        </div>
      )}
      <div className="li-body">
        <Sidebar
          open={leftOpen} onClose={() => setLeftOpen(false)}
          meta={meta} locations={locations} filtered={filtered} progress={progress} filters={filters} setFilters={setFilters}
          layerId={layer?.id ?? ''} setLayerId={(id) => { setLayerId(id); saveLocal('li.prefs', { layer: id }); }}
          app={appApi} highlight={highlight} hiddenCount={hiddenCount}
        />
        <main className="li-main">
          {loading && <div className="li-loading"><div className="li-spinner" /> Loading Leonida…</div>}
          {loadError && <div className="li-error-banner" role="alert">Could not reach the Leonida Intelligence server: {loadError}. <button onClick={() => void reload()}>Retry</button></div>}
          {!loading && meta && !layer && <div className="li-error-banner">Map tiles are not installed on the server. Run the setup script (see README → “Map data”). Markers still work.</div>}
          {mode === 'pick' && pick && (
            <div className="li-mode-banner">
              {pick.kind === 'myPosition' && 'Click the map where you are in the game.'}
              {pick.kind === 'newMarker' && 'Click the map to place your marker.'}
              {pick.kind === 'placeItem' && 'Click the map where you found this item. It will be labelled as your placement.'}
              {pick.kind === 'reviewApprove' && `Click the map where "${pick.title}" is located.`}
              {pick.kind === 'routeStart' && 'Click the map to set your route start.'}
              <button onClick={() => { setMode('none'); setPick(null); }}>Cancel (Esc)</button>
            </div>
          )}
          {mode === 'measure' && <div className="li-mode-banner">Measuring straight-line distance: click points on the map. <button onClick={() => setMode('none')}>Done</button></div>}
          {highlight && (
            <div className="li-highlight-banner">
              Showing {highlight.ids.size} {highlight.label.toLowerCase()} only. <button onClick={() => setHighlight(null)}>Show all</button>
            </div>
          )}
          <MapView
            layer={layer} locations={filtered} progress={progress} selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setSelectedMarkerId(null); }}
            markers={markers} onMarkerClick={(id) => { setSelectedMarkerId(id); setSelectedId(null); }}
            myPosition={settings?.myPosition ?? null} route={routePoints} mode={mode} onPick={onPick} fly={fly}
          />
          <div className="li-map-tools">
            <button className={mode === 'measure' ? 'active' : ''} onClick={() => setMode(mode === 'measure' ? 'none' : 'measure')} title="Measure distance">📏<span>Measure</span></button>
            <button onClick={() => startPick({ kind: 'newMarker' })} title="Add your own marker">📍<span>Add pin</span></button>
            <button onClick={() => startPick({ kind: 'myPosition' })} title="Set where you are">🧭<span>I'm here</span></button>
          </div>
          <BottomBar stats={stats} progress={progress} byId={byId} app={appApi} />
        </main>
        {rightOpen && (
          <aside className="li-right" aria-label="Details">
            {selected ? (
              <DetailPanel
                key={selected.id} loc={selected} progress={progress[selected.id]} app={appApi} maxChapter={meta?.maxChapter ?? 5}
                inRoute={route.ids.includes(selected.id)}
                onToggleRoute={() => setRoute((r) => { const ids = r.ids.includes(selected.id) ? r.ids.filter((x) => x !== selected.id) : [...r.ids, selected.id]; const n = { ...r, ids }; saveLocal('li.route', n); return n; })}
                onClose={() => setSelectedId(null)} backToTool={tool}
              />
            ) : selectedMarker ? (
              <MarkerPanel marker={selectedMarker} onClose={() => setSelectedMarkerId(null)} onSaved={(m) => setMarkers((ms) => ms.map((x) => (x.id === m.id ? m : x)))} onDeleted={(id) => { setMarkers((ms) => ms.filter((x) => x.id !== id)); setSelectedMarkerId(null); }} toast={toast} />
            ) : tool ? (
              <ToolsPanel
                tool={tool} setTool={setTool} app={appApi} locations={locations} filtered={filtered} progress={progress} meta={meta}
                settings={settings} stats={stats} byId={byId} markers={markers} route={route}
                setRoute={(r) => { setRoute(r); saveLocal('li.route', r); }} updating={updating} onUpdate={runUpdate}
              />
            ) : null}
          </aside>
        )}
      </div>
      {showDashboard && <Dashboard stats={stats} onClose={() => setShowDashboard(false)} app={appApi} />}
      <Toasts toasts={toasts} />
    </div>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

function MarkerPanel({ marker, onClose, onSaved, onDeleted, toast }: { marker: CustomMarker; onClose: () => void; onSaved: (m: CustomMarker) => void; onDeleted: (id: string) => void; toast: AppApi['toast'] }) {
  const [name, setName] = useState(marker.name);
  const [notes, setNotes] = useState(marker.notes);
  const [color, setColor] = useState(marker.color);
  return (
    <div className="li-panel">
      <div className="li-panel-head">
        <div><div className="li-kicker">Your marker</div><h2>{marker.name}</h2></div>
        <button className="li-icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="li-panel-body">
        <label className="li-field">Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="li-field">Colour<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
        <label className="li-field">Notes<textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <p className="li-muted">Position: x {marker.x.toFixed(0)}, y {marker.y.toFixed(0)}</p>
        <div className="li-row">
          <button className="li-btn primary" onClick={async () => { try { onSaved(await api.saveMarker({ ...marker, name, notes, color })); toast('Marker saved.', 'success'); } catch (e) { toast((e as Error).message, 'error'); } }}>Save</button>
          <button className="li-btn danger" onClick={async () => { if (!confirm('Delete this marker?')) return; await api.deleteMarker(marker.id); onDeleted(marker.id); }}>Delete</button>
        </div>
      </div>
    </div>
  );
}
