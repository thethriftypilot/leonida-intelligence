import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { LocationRecord, Progress, Verification, WorldMeta } from '../../../shared/types.ts';
import type { AppApi } from '../App.tsx';
import { DEFAULT_FILTERS, VERIFICATION_LABEL, type Filters } from '../state.ts';
import { GroupIcon } from '../icons.tsx';
import { isDone } from '../../../shared/search.ts';

interface Props {
  open: boolean;
  onClose: () => void;
  meta: WorldMeta | null;
  locations: LocationRecord[];
  filtered: LocationRecord[];
  progress: Record<string, Progress>;
  filters: Filters;
  setFilters: (f: Filters) => void;
  layerId: string;
  setLayerId: (id: string) => void;
  app: AppApi;
  highlight: { ids: Set<string>; label: string } | null;
  hiddenCount: number;
  onSurprise: () => void;
  onDashboard: () => void;
}

export function Sidebar(p: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const f = p.filters;
  const set = (patch: Partial<Filters>) => p.setFilters({ ...f, ...patch });

  const counts = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>();
    for (const l of p.locations) {
      for (const k of [l.group, `${l.group}/${l.category}`]) {
        const c = m.get(k) ?? { total: 0, done: 0 };
        c.total++;
        if (isDone(p.progress[l.id])) c.done++;
        m.set(k, c);
      }
    }
    return m;
  }, [p.locations, p.progress]);

  const toggleGroup = (g: string) => set({ groups: f.groups.includes(g) ? f.groups.filter((x) => x !== g) : [...f.groups, g] });
  const toggleCat = (key: string) => set({ hiddenCats: f.hiddenCats.includes(key) ? f.hiddenCats.filter((x) => x !== key) : [...f.hiddenCats, key] });
  const only = (g: string) => set({ groups: [g] });
  const toggleVerif = (v: Verification) => set({ verifications: f.verifications.includes(v) ? f.verifications.filter((x) => x !== v) : [...f.verifications, v] });

  return (
    <nav className={`li-left ${p.open ? 'open' : ''}`} aria-label="Categories and filters">
      <div className="li-left-head">
        <span>{p.filtered.length.toLocaleString()} of {p.locations.length.toLocaleString()} shown</span>
        <button className="li-icon-btn li-left-close" onClick={p.onClose} aria-label="Close filters"><X size={18} /></button>
      </div>
      <div className="li-mobile-actions">
        <button className="li-btn small" onClick={() => { p.onClose(); p.onSurprise(); }}>🎲 Surprise me</button>
        <button className="li-btn small" onClick={() => { p.onClose(); p.onDashboard(); }}>📊 Dashboard</button>
      </div>

      <section className="li-section">
        <h3>Map style</h3>
        <div className="li-seg">
          {p.meta?.layers.map((l) => (
            <button key={l.id} disabled={!l.installed} className={p.layerId === l.id ? 'active' : ''} onClick={() => p.setLayerId(l.id)} title={l.installed ? l.label : `${l.label} — not installed on server`}>
              {({ day: 'Day', night: 'Night', community: 'Community' } as Record<string, string>)[l.id] ?? l.label}
            </button>
          ))}
        </div>
      </section>

      <section className="li-section">
        <h3>Regions</h3>
        <div className="li-regions">
          {p.meta?.regions.slice(0, 16).map((r) => (
            <button key={r.name} className="li-chip" onClick={() => p.app.flyTo(r.x, r.y, 3)}>{r.name}</button>
          ))}
        </div>
      </section>

      <section className="li-section">
        <h3>Categories <button className="li-link" onClick={() => set({ groups: DEFAULT_FILTERS.groups, hiddenCats: DEFAULT_FILTERS.hiddenCats })}>reset</button></h3>
        <ul className="li-groups">
          {p.meta?.groups.map((g) => {
            const c = counts.get(g.key) ?? { total: 0, done: 0 };
            const on = f.groups.includes(g.key);
            return (
              <li key={g.key} className={on ? '' : 'off'}>
                <div className="li-group-row" style={{ ['--c' as string]: g.color }}>
                  <button className="li-expand" onClick={() => setExpanded((e) => ({ ...e, [g.key]: !e[g.key] }))} aria-label={`Expand ${g.label}`}>
                    {expanded[g.key] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <label className="li-group-label" data-testid={`group-${g.key}`}>
                    <input type="checkbox" checked={on} onChange={() => toggleGroup(g.key)} />
                    <span className="li-gicon"><GroupIcon group={g.key} size={14} /></span>
                    <span className="li-gname">{g.label}</span>
                  </label>
                  <span className="li-gcount" title={`${c.done} done of ${c.total}`}>{c.total ? `${c.done}/${c.total}` : '0'}</span>
                  <button className="li-only" onClick={() => only(g.key)} title="Show only this category">only</button>
                </div>
                {c.total > 0 && <div className="li-gbar"><i style={{ width: `${(c.done / c.total) * 100}%`, background: g.color }} /></div>}
                {expanded[g.key] && (
                  <ul className="li-cats">
                    {g.categories.length === 0 && <li className="li-muted small">No sourced locations in this category yet. New categories appear automatically when research finds them.</li>}
                    {g.categories.map((cat) => {
                      const key = `${g.key}/${cat.key}`;
                      const cc = counts.get(key) ?? { total: cat.count, done: 0 };
                      return (
                        <li key={key}>
                          <label className="li-check">
                            <input type="checkbox" checked={!f.hiddenCats.includes(key)} onChange={() => toggleCat(key)} />
                            <span>{cat.label}</span>
                            <small>{cc.done}/{cc.total}</small>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="li-section">
        <h3>My progress</h3>
        <label className="li-check"><input data-testid="hide-completed" type="checkbox" checked={f.hideCompleted} onChange={(e) => set({ hideCompleted: e.target.checked })} /> Hide completed / collected</label>
        <label className="li-check"><input type="checkbox" checked={f.onlyUnvisited} onChange={(e) => set({ onlyUnvisited: e.target.checked })} /> Only unvisited</label>
        <label className="li-check"><input type="checkbox" checked={f.onlyFavorites} onChange={(e) => set({ onlyFavorites: e.target.checked })} /> Only favourites</label>
        <label className="li-check"><input type="checkbox" checked={f.onlyPlanned} onChange={(e) => set({ onlyPlanned: e.target.checked })} /> Only saved for later</label>
      </section>

      <section className="li-section">
        <h3>Evidence</h3>
        {(['verified', 'corroborated', 'unconfirmed', 'disputed', 'outdated'] as Verification[]).map((v) => (
          <label key={v} className="li-check"><input type="checkbox" checked={f.verifications.includes(v)} onChange={() => toggleVerif(v)} /> <span className={`li-vdot v-${v}`} /> {VERIFICATION_LABEL[v]}</label>
        ))}
        <label className="li-check"><input type="checkbox" checked={f.showApprox} onChange={(e) => set({ showApprox: e.target.checked })} /> Include approximate positions</label>
        <label className="li-check"><input type="checkbox" checked={f.enterableOnly} onChange={(e) => set({ enterableOnly: e.target.checked })} /> Only enterable buildings</label>
      </section>

      <section className="li-section li-legend">
        <h3>Legend</h3>
        <div><span className="li-pin-demo confirmed" /> Solid ring: verified / corroborated</div>
        <div><span className="li-pin-demo uncertain" /> Dashed ring: unconfirmed or disputed</div>
        <div><span className="li-pin-demo approx" /> Faded: approximate area</div>
        <div><span className="li-pin-demo done" /> Dimmed with ✓: completed by you</div>
      </section>
      <p className="li-muted small li-left-foot">Map tiles & landmarks: GTADB contributors (CC BY 4.0). Guides & missions: GTA 6 Loot Map dataset (MIT) with links to original publishers. Unofficial — not affiliated with Rockstar Games.</p>
    </nav>
  );
}
