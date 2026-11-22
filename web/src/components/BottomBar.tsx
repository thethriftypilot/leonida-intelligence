import { useEffect, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { LocationRecord, Progress } from '../../../shared/types.ts';
import { api, type Stats } from '../api.ts';
import type { AppApi } from '../App.tsx';
import { timeAgo, loadLocal, saveLocal } from '../state.ts';

export function BottomBar({ stats, progress, byId, app }: { stats: Stats | null; progress: Record<string, Progress>; byId: Map<string, LocationRecord>; app: AppApi }) {
  const [open, setOpen] = useState<boolean>(() => loadLocal('li.bottom', { open: false }).open);
  const [recent, setRecent] = useState<{ id: string; name: string; discoveredAt: string }[]>([]);
  useEffect(() => { if (open) api.recent(7).then((r) => setRecent(r.results.slice(0, 12))).catch(() => undefined); }, [open, stats?.lastSuccessfulUpdate]);
  const completed = Object.values(progress).filter((p) => p.completedAt).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')).slice(0, 12);
  const toggle = () => { setOpen(!open); saveLocal('li.bottom', { open: !open }); };
  return (
    <section className={`li-bottom ${open ? 'open' : ''}`} aria-label="Progress summary">
      <button className="li-bottom-bar" onClick={toggle} aria-expanded={open} data-testid="bottom-toggle">
        <span className="li-ring" style={{ ['--p' as string]: `${stats?.completionPct ?? 0}%` }}><b>{Math.round(stats?.completionPct ?? 0)}%</b></span>
        <span className="li-bottom-stats">
          <span><b>{stats?.completed ?? 0}</b>/{stats?.trackable ?? 0} done</span>
          <span><b>{stats?.visited ?? 0}</b> visited</span>
          <span><b>{stats?.addedThisWeek ?? 0}</b> new this week</span>
          <span className="li-hide-sm">Updated {timeAgo(stats?.lastSuccessfulUpdate ?? null)}</span>
        </span>
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {open && (
        <div className="li-bottom-body">
          <div>
            <h4>Category progress</h4>
            {stats?.groups.filter((g) => g.key !== 'landmarks' && g.total > 0).map((g) => (
              <div key={g.key} className="li-mini">
                <span>{g.label}</span><small>{g.done}/{g.total}</small>
                <div className="li-gbar"><i style={{ width: `${g.total ? (g.done / g.total) * 100 : 0}%`, background: g.color }} /></div>
              </div>
            ))}
          </div>
          <div>
            <h4>Recently discovered by the community</h4>
            {!recent.length && <p className="li-muted small">Nothing new in the last 7 days.</p>}
            <ul className="li-plain">{recent.map((r) => <li key={r.id}><button className="li-link" onClick={() => app.select(r.id, true)}>{r.name}</button> <small>{timeAgo(r.discoveredAt)}</small></li>)}</ul>
          </div>
          <div>
            <h4>Recently completed by you</h4>
            {!completed.length && <p className="li-muted small">Mark something as collected or completed to see it here.</p>}
            <ul className="li-plain">{completed.map((p) => <li key={p.locationId}><button className="li-link" onClick={() => app.select(p.locationId, true)}>{byId.get(p.locationId)?.name ?? p.locationId}</button> <small>{timeAgo(p.completedAt)}</small></li>)}</ul>
          </div>
        </div>
      )}
    </section>
  );
}
