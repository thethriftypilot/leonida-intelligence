import { X } from 'lucide-react';
import type { Stats } from '../api.ts';
import type { AppApi } from '../App.tsx';
import { timeAgo } from '../state.ts';

export function Dashboard({ stats, onClose, app }: { stats: Stats | null; onClose: () => void; app: AppApi }) {
  if (!stats) return null;
  const pending = Object.values(stats.reviewPending).reduce((a, b) => a + b, 0);
  const cards: [string, string | number, string?][] = [
    ['Total locations', stats.totalLocations.toLocaleString(), `${stats.mapped.toLocaleString()} on the map · ${stats.unplaced} awaiting a position`],
    ['Verified by you', stats.verified, 'Confirmed in-game'],
    ['Community corroborated', stats.corroborated.toLocaleString(), 'Photo or screenshot evidence'],
    ['Unconfirmed / disputed', `${stats.unconfirmed.toLocaleString()} / ${stats.disputed}`],
    ['Added this week', stats.addedThisWeek.toLocaleString()],
    ['My completion', `${stats.completionPct}%`, `${stats.completed} of ${stats.trackable} gameplay discoveries`],
    ['Unvisited discoveries', stats.unvisited.toLocaleString()],
    ['Awaiting review', pending, 'Leads, duplicates, bad coordinates'],
    ['Hidden by spoiler protection', stats.hiddenBySpoilers],
    ['Last successful update', timeAgo(stats.lastSuccessfulUpdate), stats.nextUpdateAt ? `Next ${timeAgo(stats.nextUpdateAt)}` : ''],
  ];
  return (
    <div className="li-modal" role="dialog" aria-modal="true" aria-label="Dashboard" onClick={onClose}>
      <div className="li-modal-card" onClick={(e) => e.stopPropagation()} data-testid="dashboard">
        <div className="li-panel-head"><div className="li-head-text"><div className="li-kicker">Leonida Intelligence</div><h2>Dashboard</h2></div><button className="li-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="li-cards">
          {cards.map(([k, v, s]) => <div key={k} className="li-card"><div className="li-card-k">{k}</div><div className="li-card-v">{v}</div>{s && <div className="li-card-s">{s}</div>}</div>)}
        </div>
        <div className="li-dash-cols">
          <div>
            <h4>Category progress</h4>
            {stats.groups.map((g) => (
              <div key={g.key} className="li-mini">
                <span>{g.label}</span><small>{g.done}/{g.total} done · {g.visited} visited</small>
                <div className="li-gbar"><i style={{ width: `${g.total ? (g.done / g.total) * 100 : 0}%`, background: g.color }} /></div>
              </div>
            ))}
          </div>
          <div>
            <h4>Research source health</h4>
            <ul className="li-sources">
              {stats.sources.map((s) => (
                <li key={s.id}>
                  <b>{s.name}</b> <span className={`li-status st-${s.enabled ? s.lastStatus : 'disabled'}`}>{s.enabled ? s.lastStatus : 'disabled'}</span>
                  <div className="small li-muted">{s.recordCount} records · last success {timeAgo(s.lastSuccessAt)}</div>
                  {s.lastError && <div className="li-error small">{s.lastError}</div>}
                </li>
              ))}
            </ul>
            {stats.lastRun && <p className="small">Last run #{stats.lastRun.id} ({stats.lastRun.status}): {stats.lastRun.summary}</p>}
            <button className="li-btn small" onClick={() => { onClose(); app.openTool('updates'); }}>Open update reports</button>
          </div>
        </div>
      </div>
    </div>
  );
}
