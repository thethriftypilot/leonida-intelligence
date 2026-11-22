import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { CustomMarker, LocationRecord, Progress, ReviewItem, SavedRoute, SourceInfo, UpdateRun, WorldMeta, Checklist } from '../../../shared/types.ts';
import { api, type BriefHit, type Settings, type Stats } from '../api.ts';
import type { AppApi } from '../App.tsx';
import { GROUPS, GROUP_BY_KEY } from '../../../shared/categories.ts';
import { isDone, orderRoute } from '../../../shared/search.ts';
import { distance, formatDistance } from '../../../shared/coords.ts';
import { GroupIcon } from '../icons.tsx';
import { timeAgo, VERIFICATION_LABEL } from '../state.ts';

export type ToolId = 'search' | 'useful' | 'first' | 'nearby' | 'planner' | 'missing' | 'community' | 'review' | 'updates' | 'data';

const TABS: { id: ToolId; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'useful', label: 'Find useful' },
  { id: 'first', label: 'Get first' },
  { id: 'nearby', label: 'Nearby' },
  { id: 'planner', label: 'Planner' },
  { id: 'missing', label: 'Missing' },
  { id: 'community', label: 'Community' },
  { id: 'review', label: 'Review' },
  { id: 'updates', label: 'Updates' },
  { id: 'data', label: 'My data' },
];

interface Props {
  tool: ToolId;
  setTool: (t: ToolId | null) => void;
  app: AppApi;
  locations: LocationRecord[];
  filtered: LocationRecord[];
  progress: Record<string, Progress>;
  meta: WorldMeta | null;
  settings: Settings | null;
  stats: Stats | null;
  byId: Map<string, LocationRecord>;
  markers: CustomMarker[];
  route: { start: { x: number; y: number } | null; ids: string[] };
  setRoute: (r: { start: { x: number; y: number } | null; ids: string[] }) => void;
  updating: boolean;
  onUpdate: () => void;
}

export function ToolsPanel(p: Props) {
  const pending = Object.values(p.stats?.reviewPending ?? {}).reduce((a, b) => a + b, 0);
  return (
    <div className="li-panel" data-testid="tools-panel">
      <div className="li-panel-head">
        <div className="li-head-text"><div className="li-kicker">Smart tools</div><h2>{TABS.find((t) => t.id === p.tool)?.label}</h2></div>
        <button className="li-icon-btn" onClick={() => { p.setTool(null); p.app.setHighlight(null); }} aria-label="Close tools"><X size={18} /></button>
      </div>
      <div className="li-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={p.tool === t.id} className={p.tool === t.id ? 'active' : ''} onClick={() => p.setTool(t.id)} data-testid={`tab-${t.id}`}>
            {t.label}{t.id === 'review' && pending > 0 ? <span className="li-count">{pending}</span> : null}
          </button>
        ))}
      </div>
      <div className="li-panel-body">
        {p.tool === 'search' && <SearchTool {...p} />}
        {p.tool === 'useful' && <UsefulTool {...p} />}
        {p.tool === 'first' && <FirstTool {...p} />}
        {p.tool === 'nearby' && <NearbyTool {...p} />}
        {p.tool === 'planner' && <PlannerTool {...p} />}
        {p.tool === 'missing' && <MissingTool {...p} />}
        {p.tool === 'community' && <CommunityTool {...p} />}
        {p.tool === 'review' && <ReviewTool {...p} />}
        {p.tool === 'updates' && <UpdatesTool {...p} />}
        {p.tool === 'data' && <DataTool {...p} />}
      </div>
    </div>
  );
}

function HitList({ hits, app, byId, progress, extra, testid }: { hits: BriefHit[]; app: AppApi; byId: Map<string, LocationRecord>; progress: Record<string, Progress>; extra?: (h: BriefHit) => React.ReactNode; testid?: string }) {
  if (!hits.length) return <p className="li-empty">Nothing found.</p>;
  return (
    <ul className="li-hits" data-testid={testid}>
      {hits.map((h) => {
        const l = byId.get(h.id);
        const done = isDone(progress[h.id]);
        return (
          <li key={h.id} className={done ? 'done' : ''}>
            <button onClick={() => app.select(h.id, true)} style={{ ['--c' as string]: GROUP_BY_KEY[h.group]?.color }}>
              <span className="li-hit-icon"><GroupIcon group={h.group} size={14} /></span>
              <span className="li-hit-main">
                <span className="li-hit-name">{h.name}{done ? ' ✓' : ''}</span>
                <small>{h.category}{l?.region ? ` · ${l.region}` : ''}{l && l.x === null ? ' · position unknown' : ''}{l ? ` · ${VERIFICATION_LABEL[l.verification]}` : ''}</small>
                {extra?.(h)}
              </span>
              {typeof h.distance === 'number' && <span className="li-hit-dist">{formatDistance(h.distance)}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SearchTool(p: Props) {
  const [q, setQ] = useState<string>(() => (window as unknown as { __liSearch?: string }).__liSearch ?? '');
  const [res, setRes] = useState<Awaited<ReturnType<typeof api.search>> | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true);
    try { setRes(await api.search(text)); } catch (e) { p.app.toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  useEffect(() => {
    const h = (e: Event) => { const t = (e as CustomEvent<string>).detail; setQ(t); void run(t); };
    window.addEventListener('li-search', h);
    if (q) void run(q);
    return () => window.removeEventListener('li-search', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const examples = ['Where can I get a free gun early in the game?', 'Show me hidden cash near Vice City', 'Find rare cars I can access right now', "What secrets haven't I discovered?", 'What should I do before moving to the next chapter?'];
  return (
    <div data-testid="search-tool">
      <form className="li-row" onSubmit={(e) => { e.preventDefault(); void run(q); }}>
        <input className="li-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about Leonida…" aria-label="Search query" />
        <button className="li-btn primary" type="submit" disabled={busy}>Search</button>
      </form>
      {!res && <div className="li-examples">{examples.map((e) => <button key={e} className="li-chip" onClick={() => { setQ(e); void run(e); }}>{e}</button>)}</div>}
      {res && (
        <>
          <p className="li-muted small" data-testid="search-interpretation">Understood as: {res.interpretation.length ? res.interpretation.join(' · ') : 'keyword search'}{res.fallback ? ' (no exact keyword match — showing the whole category)' : ''}</p>
          <p className="li-muted small">Answers come from the structured local database only. {res.results.length} result{res.results.length === 1 ? '' : 's'}.</p>
          {res.results.length > 0 && <button className="li-btn" onClick={() => p.app.setHighlight(res.results.map((r) => r.id), 'Search results')}>Show only these on the map</button>}
          <HitList hits={res.results} app={p.app} byId={p.byId} progress={p.progress} testid="search-results" />
        </>
      )}
    </div>
  );
}

function UsefulTool(p: Props) {
  const [group, setGroup] = useState<string>('money');
  const items = useMemo(() => p.locations.filter((l) => l.group === group && l.category !== 'Unnamed buildings')
    .sort((a, b) => Number(isDone(p.progress[a.id])) - Number(isDone(p.progress[b.id])) || b.confidence - a.confidence), [p.locations, p.progress, group]);
  return (
    <div>
      <p className="li-muted">Pick what you're after:</p>
      <div className="li-group-grid">
        {GROUPS.filter((g) => g.key !== 'landmarks').map((g) => (
          <button key={g.key} className={group === g.key ? 'active' : ''} style={{ ['--c' as string]: g.color }} onClick={() => setGroup(g.key)}>
            <GroupIcon group={g.key} size={18} /><span>{g.label}</span>
          </button>
        ))}
      </div>
      <div className="li-row">
        <button className="li-btn" disabled={!items.length} onClick={() => p.app.setHighlight(items.map((i) => i.id), GROUP_BY_KEY[group].label)}>Show {items.length} on map</button>
      </div>
      {!items.length && <p className="li-empty">No sourced {GROUP_BY_KEY[group].label.toLowerCase()} are known yet (or they are hidden by spoiler protection). The research engine will add them when a permitted source publishes them.</p>}
      <HitList hits={items.slice(0, 200).map((l) => ({ id: l.id, name: l.name, group: l.group, category: l.category }))} app={p.app} byId={p.byId} progress={p.progress} />
    </div>
  );
}

function FirstTool(p: Props) {
  const [recs, setRecs] = useState<(BriefHit & { reasons: string[] })[] | null>(null);
  useEffect(() => { api.recommendations().then((r) => setRecs(r.recommendations)).catch((e) => p.app.toast(e.message, 'error')); }, [p.settings?.spoilers.chapter, p.progress, p.app]);
  return (
    <div>
      <div className="li-note">These are <b>subjective recommendations</b> computed from usefulness, reported rewards, chapter availability, missability and evidence quality. The facts behind each item (shown under it) come from its sources.</div>
      {!recs ? <div className="li-spinner" /> : <HitList hits={recs} app={p.app} byId={p.byId} progress={p.progress} extra={(h) => <span className="li-reasons">{(h as BriefHit & { reasons: string[] }).reasons.join(' · ')}</span>} testid="recommendations" />}
    </div>
  );
}

function NearbyTool(p: Props) {
  const pos = p.settings?.myPosition ?? null;
  const [radius, setRadius] = useState(1500);
  const [hideDone, setHideDone] = useState(true);
  const [hits, setHits] = useState<BriefHit[] | null>(null);
  useEffect(() => {
    if (!pos) return;
    api.nearby(pos.x, pos.y, radius, null, hideDone).then((r) => setHits(r.results)).catch((e) => p.app.toast(e.message, 'error'));
  }, [pos, radius, hideDone, p.app, p.progress]);
  return (
    <div>
      <p className="li-muted">Your PlayStation doesn't share your live position, so set it manually.</p>
      <div className="li-row li-wrap">
        <button className="li-btn primary" onClick={() => p.app.startPick({ kind: 'myPosition' })}>{pos ? 'Move my position' : 'Set my position on the map'}</button>
        {pos && <button className="li-btn" onClick={() => p.app.flyTo(pos.x, pos.y, 4)}>Go to me</button>}
      </div>
      {pos && (
        <>
          <div className="li-row li-wrap">
            <label className="li-field inline">Radius
              <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>{[500, 1000, 1500, 3000, 5000].map((r) => <option key={r} value={r}>{formatDistance(r)}</option>)}</select>
            </label>
            <label className="li-check"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide completed</label>
          </div>
          <p className="li-muted small">Straight-line distances (no in-game road data is available).</p>
          {hits ? <HitList hits={hits} app={p.app} byId={p.byId} progress={p.progress} testid="nearby-results" /> : <div className="li-spinner" />}
        </>
      )}
    </div>
  );
}

function PlannerTool(p: Props) {
  const [saved, setSaved] = useState<SavedRoute[]>([]);
  useEffect(() => { api.routes().then(setSaved).catch(() => undefined); }, []);
  const pts = p.route.ids.map((id) => p.byId.get(id)).filter((l): l is LocationRecord => !!l && l.x !== null);
  const legs: number[] = [];
  let prev = p.route.start;
  for (const l of pts) { legs.push(prev ? distance(prev, { x: l.x!, y: l.y! }) : 0); prev = { x: l.x!, y: l.y! }; }
  const total = legs.reduce((a, b) => a + b, 0);
  const move = (i: number, d: number) => { const ids = [...p.route.ids]; const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; p.setRoute({ ...p.route, ids }); };
  const optimize = () => {
    const o = orderRoute(p.route.start, pts.map((l) => ({ id: l.id, x: l.x!, y: l.y! })));
    p.setRoute({ ...p.route, ids: o.order.map((x) => x.id) });
    p.app.toast(`Waypoints reordered: ${formatDistance(o.total)} straight-line total.`);
  };
  const addPlanned = () => {
    const ids = Object.values(p.progress).filter((x) => x.planned && !isDone(x)).map((x) => x.locationId).filter((id) => p.byId.get(id)?.x !== null && p.byId.has(id) && !p.route.ids.includes(id));
    p.setRoute({ ...p.route, ids: [...p.route.ids, ...ids] });
    p.app.toast(`${ids.length} planned locations added.`);
  };
  return (
    <div data-testid="planner">
      <div className="li-note">Routing uses <b>straight-line distances</b> and waypoint ordering. Real in-game road routing isn't possible because no licensed road-network data exists for Leonida.</div>
      <div className="li-row li-wrap">
        <button className="li-btn" onClick={() => p.app.startPick({ kind: 'routeStart' })}>{p.route.start ? 'Move start' : 'Set start point'}</button>
        {p.settings?.myPosition && <button className="li-btn" onClick={() => p.setRoute({ ...p.route, start: p.settings!.myPosition })}>Start from my position</button>}
        <button className="li-btn" onClick={addPlanned}>Add my “planned” items</button>
        <button className="li-btn primary" disabled={pts.length < 2} onClick={optimize}>Optimise order</button>
        <button className="li-btn ghost" disabled={!p.route.ids.length} onClick={() => p.setRoute({ start: p.route.start, ids: [] })}>Clear</button>
      </div>
      {!pts.length && <p className="li-empty">Open any location and press “Add to route”, or add your planned items.</p>}
      <ol className="li-route">
        {pts.map((l, i) => (
          <li key={l.id}>
            <button className="li-link" onClick={() => p.app.select(l.id, true)}>{l.name}</button>
            <small>{legs[i] ? `+${formatDistance(legs[i])}` : ''}</small>
            <span className="li-route-btns">
              <button onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button onClick={() => p.setRoute({ ...p.route, ids: p.route.ids.filter((x) => x !== l.id) })} aria-label="Remove">✕</button>
            </span>
          </li>
        ))}
      </ol>
      {pts.length > 0 && <p><b>Total (straight line): {formatDistance(total)}</b></p>}
      {pts.length > 0 && <button className="li-btn" onClick={async () => { const name = prompt('Route name', `Route ${new Date().toLocaleDateString()}`); if (!name) return; const r = await api.saveRoute({ name, waypoints: p.route.ids, start: p.route.start }); setSaved((s) => [r, ...s]); p.app.toast('Route saved on the server.', 'success'); }}>Save route</button>}
      {saved.length > 0 && <h4>Saved routes</h4>}
      <ul className="li-plain">
        {saved.map((r) => (
          <li key={r.id}><button className="li-link" onClick={() => p.setRoute({ start: r.start, ids: r.waypoints })}>{r.name}</button> <small>{r.waypoints.length} stops</small> <button className="li-link danger" onClick={async () => { await api.deleteRoute(r.id); setSaved((s) => s.filter((x) => x.id !== r.id)); }}>delete</button></li>
        ))}
      </ul>
    </div>
  );
}

function MissingTool(p: Props) {
  const rows = useMemo(() => {
    const m = new Map<string, { group: string; category: string; total: number; done: number; ids: string[] }>();
    for (const l of p.locations) {
      if (l.group === 'landmarks') continue;
      const k = `${l.group}/${l.category}`;
      const r = m.get(k) ?? { group: l.group, category: l.category, total: 0, done: 0, ids: [] };
      r.total++;
      if (isDone(p.progress[l.id])) r.done++; else r.ids.push(l.id);
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => (b.total - b.done) - (a.total - a.done));
  }, [p.locations, p.progress]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div data-testid="missing">
      <p className="li-muted">Collections and categories you haven't finished (within what spoiler protection lets you see).</p>
      <ul className="li-missing">
        {rows.map((r) => {
          const k = `${r.group}/${r.category}`;
          return (
            <li key={k}>
              <button onClick={() => setOpen(open === k ? null : k)} style={{ ['--c' as string]: GROUP_BY_KEY[r.group]?.color }}>
                <GroupIcon group={r.group} size={14} /><span>{r.category}</span><b>{r.total - r.done} left</b><small>{r.done}/{r.total}</small>
              </button>
              <div className="li-gbar"><i style={{ width: `${(r.done / r.total) * 100}%`, background: GROUP_BY_KEY[r.group]?.color }} /></div>
              {open === k && (
                <>
                  <button className="li-btn small" onClick={() => p.app.setHighlight(r.ids, `Missing ${r.category}`)}>Show remaining on map</button>
                  <HitList hits={r.ids.map((id) => p.byId.get(id)!).filter(Boolean).map((l) => ({ id: l.id, name: l.name, group: l.group, category: l.category }))} app={p.app} byId={p.byId} progress={p.progress} />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CommunityTool(p: Props) {
  const [days, setDays] = useState(7);
  const [hits, setHits] = useState<(BriefHit & { discoveredAt: string })[] | null>(null);
  useEffect(() => { setHits(null); api.recent(days).then((r) => setHits(r.results)).catch((e) => p.app.toast(e.message, 'error')); }, [days, p.app]);
  return (
    <div data-testid="community">
      <div className="li-seg">{[1, 7, 30].map((d) => <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{d === 1 ? '24 hours' : `${d} days`}</button>)}</div>
      <p className="li-muted small">Locations newly added or newly documented by the community in this window (from source edit timestamps where available, otherwise when Leonida Intelligence first found them).</p>
      {!hits ? <div className="li-spinner" /> : (
        <>
          {hits.length > 0 && <button className="li-btn" onClick={() => p.app.setHighlight(hits.map((h) => h.id), 'Recent community finds')}>Show {hits.length} on map</button>}
          <HitList hits={hits} app={p.app} byId={p.byId} progress={p.progress} extra={(h) => <span className="li-reasons">{timeAgo((h as BriefHit & { discoveredAt: string }).discoveredAt)}</span>} />
        </>
      )}
    </div>
  );
}

function ReviewTool(p: Props) {
  const [kind, setKind] = useState('');
  const [data, setData] = useState<{ items: ReviewItem[]; counts: Record<string, number> } | null>(null);
  const unplaced = useMemo(() => p.locations.filter((l) => l.x === null), [p.locations]);
  const load = () => api.review('pending', kind === 'unplaced' ? '' : kind).then(setData).catch((e) => p.app.toast(e.message, 'error'));
  useEffect(() => { void load(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const resolve = async (id: number, action: 'reject' | 'dismiss') => { await api.resolveReview(id, { action }); await load(); };
  const labels: Record<string, string> = { lead: 'Research leads', 'invalid-coordinates': 'Bad coordinates', 'possible-duplicate': 'Possible duplicates', unplaced: 'Unplaced items' };
  return (
    <div data-testid="review">
      <div className="li-seg li-wrap">
        <button className={kind === '' ? 'active' : ''} onClick={() => setKind('')}>All</button>
        {['lead', 'possible-duplicate', 'invalid-coordinates'].map((k) => <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{labels[k]} {data?.counts[k] ? `(${data.counts[k]})` : ''}</button>)}
        <button className={kind === 'unplaced' ? 'active' : ''} onClick={() => setKind('unplaced')}>{labels.unplaced} ({unplaced.length})</button>
      </div>
      {kind === 'unplaced' ? (
        <>
          <p className="li-muted small">Sourced discoveries whose exact position isn't published yet. They are never placed at guessed coordinates; if you find one in-game you can place it yourself (it will be labelled as your placement).</p>
          <HitList hits={unplaced.map((l) => ({ id: l.id, name: l.name, group: l.group, category: l.category }))} app={p.app} byId={p.byId} progress={p.progress} />
        </>
      ) : !data ? <div className="li-spinner" /> : data.items.length === 0 ? <p className="li-empty">Nothing waiting for review.</p> : (
        <ul className="li-review">
          {data.items.map((it) => (
            <li key={it.id}>
              <div className="li-kicker">{labels[it.kind] ?? it.kind} · {timeAgo(it.createdAt)}{it.suggestedGroup ? ` · looks like ${GROUP_BY_KEY[it.suggestedGroup]?.label}` : ''}</div>
              <b>{it.title}</b>
              {it.summary && <p className="li-muted small">{it.summary}</p>}
              <div className="li-row li-wrap">
                {it.url && <a className="li-btn small" href={it.url} target="_blank" rel="noopener noreferrer">Open source</a>}
                <button className="li-btn small primary" onClick={() => p.app.startPick({ kind: 'reviewApprove', reviewId: it.id, title: it.title, group: it.suggestedGroup })}>Place on map…</button>
                <button className="li-btn small" onClick={() => resolve(it.id, 'dismiss')}>Dismiss</button>
                <button className="li-btn small danger" onClick={() => resolve(it.id, 'reject')}>Reject</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UpdatesTool(p: Props) {
  const [runs, setRuns] = useState<UpdateRun[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [interval, setIntervalH] = useState(p.settings?.updateIntervalHours ?? 12);
  const [detail, setDetail] = useState<{ run: UpdateRun; changes: { location_id: string; change: string; name: string | null }[] } | null>(null);
  const [cfgEdit, setCfgEdit] = useState<{ id: string; text: string } | null>(null);
  const load = () => { api.updates().then((u) => setRuns(u.runs)).catch(() => undefined); api.sources().then(setSources).catch(() => undefined); };
  useEffect(load, [p.updating]);
  return (
    <div data-testid="updates">
      <div className="li-row li-wrap">
        <button className="li-btn primary" disabled={p.updating} onClick={p.onUpdate} data-testid="run-update">{p.updating ? 'Update running…' : 'Check for updates now'}</button>
        <span className="li-muted small">Next automatic check {timeAgo(p.settings?.nextUpdateAt ?? null)}</span>
      </div>
      <div className="li-row li-wrap">
        <label className="li-field inline">Check every
          <input type="number" min={1} max={336} value={interval} onChange={(e) => setIntervalH(Number(e.target.value))} style={{ width: 70 }} /> hours
        </label>
        <button className="li-btn small" onClick={async () => { try { await api.saveSettings({ updateIntervalHours: interval }); p.app.toast('Schedule saved.', 'success'); await p.app.reload(); } catch (e) { p.app.toast((e as Error).message, 'error'); } }}>Save</button>
      </div>
      <h4>Sources</h4>
      <ul className="li-sources">
        {sources.map((s) => (
          <li key={s.id} className={`st-${s.lastStatus}`}>
            <div className="li-row">
              <label className="li-check"><input type="checkbox" checked={s.enabled} onChange={async (e) => { await api.updateSource(s.id, { enabled: e.target.checked }); load(); }} disabled={s.kind === 'import'} /> <b>{s.name}</b></label>
            </div>
            <div className="li-muted small">{s.description}</div>
            <div className="small">Status: <span className={`li-status st-${s.lastStatus}`}>{s.lastStatus}</span> · last run {timeAgo(s.lastRunAt)} · last success {timeAgo(s.lastSuccessAt)} · {s.recordCount} records{s.revision ? ` · rev ${s.revision.slice(0, 10)}` : ''}</div>
            {s.lastError && <div className="li-error small">{s.lastError}</div>}
            <div className="li-muted small">Licence: {s.license}. {s.homepage && <a href={s.homepage} target="_blank" rel="noopener noreferrer">Homepage</a>}</div>
            {s.kind !== 'import' && <button className="li-link" onClick={async () => setCfgEdit({ id: s.id, text: JSON.stringify(await api.sourceConfig(s.id), null, 2) })}>Edit settings</button>}
            {cfgEdit?.id === s.id && (
              <div>
                <textarea className="li-notes mono" rows={10} value={cfgEdit.text} onChange={(e) => setCfgEdit({ ...cfgEdit, text: e.target.value })} />
                <div className="li-row">
                  <button className="li-btn small primary" onClick={async () => { try { await api.updateSource(s.id, { config: JSON.parse(cfgEdit.text) }); setCfgEdit(null); p.app.toast('Source settings saved.', 'success'); } catch (e) { p.app.toast(`Invalid settings: ${(e as Error).message}`, 'error'); } }}>Save</button>
                  <button className="li-btn small" onClick={() => setCfgEdit(null)}>Cancel</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <h4>Update reports</h4>
      <ul className="li-runs" data-testid="update-runs">
        {runs.map((r) => (
          <li key={r.id} className={`st-${r.status}`}>
            <button className="li-link" onClick={async () => setDetail(await api.updateDetail(r.id))}>#{r.id} · {new Date(r.startedAt).toLocaleString()} · {r.trigger}</button>
            <span className={`li-status st-${r.status}`}>{r.status}</span>
            <div className="small">{r.summary}</div>
          </li>
        ))}
      </ul>
      {detail && (
        <div className="li-modal-inner">
          <h4>Report #{detail.run.id}</h4>
          {detail.run.sources.map((s) => (
            <div key={s.sourceId} className="small">
              <b>{s.sourceId}</b>: {s.status} · +{s.added} / ~{s.updated} / −{s.removed} · {s.queued} queued · {s.rejected} rejected · {(s.durationMs / 1000).toFixed(1)} s
              {s.error && <div className="li-error">{s.error}</div>}
              {s.notes.length > 0 && <ul>{s.notes.slice(0, 20).map((n, i) => <li key={i}>{n}</li>)}</ul>}
            </div>
          ))}
          {detail.changes.length > 0 && <details><summary>{detail.changes.length} record changes</summary><ul className="small">{detail.changes.slice(0, 300).map((c, i) => <li key={i}>{c.change}: <button className="li-link" onClick={() => p.app.select(c.location_id, true)}>{c.name ?? c.location_id}</button></li>)}</ul></details>}
          <button className="li-btn small" onClick={() => setDetail(null)}>Close report</button>
        </div>
      )}
    </div>
  );
}

function DataTool(p: Props) {
  const [backups, setBackups] = useState<Awaited<ReturnType<typeof api.backups>> | null>(null);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState<'game' | 'normalized'>('game');
  const [importLabel, setImportLabel] = useState('My import');
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('replace');
  const load = () => { api.backups().then(setBackups).catch(() => undefined); api.checklists().then(setChecklists).catch(() => undefined); };
  useEffect(load, []);

  const readFile = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(f); });

  return (
    <div data-testid="data-tool">
      <h4>Backup & restore</h4>
      <p className="li-muted small">Your progress lives in a database on the host computer (shared by every device). Research updates never modify it. Automatic backups are taken daily and before every restore or schema change.</p>
      <div className="li-row li-wrap">
        <a className="li-btn primary" href={api.exportUrl} download data-testid="export-backup">Download backup (JSON)</a>
        <button className="li-btn" onClick={async () => { const b = await api.createBackup(); p.app.toast(`Server backup created: ${b.name}`, 'success'); load(); }}>Create server backup</button>
      </div>
      <div className="li-row li-wrap">
        <label className="li-field inline">Restore mode
          <select value={restoreMode} onChange={(e) => setRestoreMode(e.target.value as 'replace' | 'merge')}><option value="replace">Replace everything</option><option value="merge">Merge (keep newer local rows)</option></select>
        </label>
        <label className="li-btn">Restore from file…<input type="file" accept="application/json,.json" hidden data-testid="restore-file" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const data = JSON.parse(await readFile(f));
            if (!confirm(`${restoreMode === 'replace' ? 'Replace' : 'Merge'} your progress with “${f.name}”? A safety backup is taken first.`)) return;
            const r = await api.restore(data, restoreMode);
            p.app.toast(`Restored: ${Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ')}`, 'success');
            await p.app.reload();
            load();
          } catch (err) { p.app.toast(`Restore failed: ${(err as Error).message}`, 'error'); }
          e.target.value = '';
        }} /></label>
      </div>
      {backups && (
        <details>
          <summary>Server backups ({backups.user.length}) & research snapshots ({backups.world.length})</summary>
          <ul className="li-plain small">
            {backups.user.slice(0, 30).map((b) => <li key={b.name}>{b.name} · {(b.size / 1024).toFixed(0)} KB <button className="li-link" onClick={async () => { if (!confirm(`Restore progress from ${b.name}? A safety backup is taken first.`)) return; await api.restoreBackup(b.name); await p.app.reload(); p.app.toast('Progress restored.', 'success'); }}>restore</button></li>)}
          </ul>
          <p className="li-muted small">Research snapshots (taken before each update) can roll back the shared location data if an update goes wrong. Your progress is not affected.</p>
          <ul className="li-plain small">
            {backups.world.map((b) => <li key={b.name}>{b.name} <button className="li-link" onClick={async () => { if (!confirm(`Roll research data back to ${b.name}?`)) return; try { await api.restoreSnapshot(b.name); await p.app.reload(); p.app.toast('Research data rolled back.', 'success'); } catch (e) { p.app.toast((e as Error).message, 'error'); } }}>roll back</button></li>)}
          </ul>
        </details>
      )}

      <h4>My markers ({p.markers.length})</h4>
      <ul className="li-plain">
        {p.markers.map((m) => <li key={m.id}><button className="li-link" onClick={() => p.app.flyTo(m.x, m.y, 5)}>{m.name}</button></li>)}
      </ul>
      <button className="li-btn small" onClick={() => p.app.startPick({ kind: 'newMarker' })}>Add a marker</button>

      <h4>Checklists</h4>
      {checklists.map((c) => (
        <div key={c.id} className="li-checklist">
          <div className="li-row"><b>{c.name}</b> <small>{c.items.filter((i) => i.done).length}/{c.items.length}</small> <button className="li-link danger" onClick={async () => { if (confirm('Delete checklist?')) { await api.deleteChecklist(c.id); load(); } }}>delete</button></div>
          <ul className="li-plain">
            {c.items.map((i) => (
              <li key={i.id}>
                <label className="li-check"><input type="checkbox" checked={i.done} onChange={async (e) => { await api.updateChecklistItem(i.id, { done: e.target.checked }); load(); }} /> {i.text}</label>
                {i.locationId && <button className="li-link" onClick={() => p.app.select(i.locationId!, true)}>map</button>}
                <button className="li-link danger" onClick={async () => { await api.deleteChecklistItem(i.id); load(); }}>✕</button>
              </li>
            ))}
          </ul>
          <form className="li-row" onSubmit={async (e) => { e.preventDefault(); const inp = (e.currentTarget.elements.namedItem('t') as HTMLInputElement); if (!inp.value) return; await api.addChecklistItem(c.id, inp.value); inp.value = ''; load(); }}>
            <input name="t" className="li-input" placeholder="Add item…" /><button className="li-btn small">Add</button>
          </form>
        </div>
      ))}
      <button className="li-btn small" onClick={async () => { const n = prompt('Checklist name'); if (n) { await api.createChecklist(n); load(); } }}>New checklist</button>

      <h4>Import locations</h4>
      <p className="li-muted small">Paste or load GeoJSON, a JSON array or CSV (columns: name, category, x, y, description, source_url). Coordinates must be GTADB game units (x east, y north — shown bottom-left of the map) or the normalised 0–1 frame. Rows without valid coordinates or that duplicate existing places go to the review queue.</p>
      <div className="li-row li-wrap">
        <input className="li-input" value={importLabel} onChange={(e) => setImportLabel(e.target.value)} placeholder="Source label" />
        <select value={importFormat} onChange={(e) => setImportFormat(e.target.value as 'game' | 'normalized')}><option value="game">Game units</option><option value="normalized">Normalised 0–1</option></select>
        <label className="li-btn small">Load file…<input type="file" hidden accept=".json,.geojson,.csv,text/csv,application/json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImportText(await readFile(f)); }} /></label>
      </div>
      <textarea className="li-notes mono" rows={5} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='name,category,x,y&#10;My stash,Hidden items,-3700,700' />
      <button className="li-btn primary small" disabled={!importText.trim()} onClick={async () => {
        try {
          const r = await api.importData({ data: importText, format: importFormat, sourceLabel: importLabel });
          p.app.toast(`Import: ${r.added} added, ${r.updated} updated, ${r.queued} sent to review, ${r.rejected} rejected.`, 'success');
          setImportText('');
          await p.app.reload();
        } catch (e) { p.app.toast(`Import failed: ${(e as Error).message}`, 'error'); }
      }}>Import</button>
    </div>
  );
}
