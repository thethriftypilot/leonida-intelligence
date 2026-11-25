import { useEffect, useRef, useState } from 'react';
import { X, Download, Copy, Share2 } from 'lucide-react';
import type { Achievement } from '../../../shared/achievements.ts';
import { drawProgressCard } from '../shareCard.ts';
import type { Stats } from '../api.ts';
import type { AppApi } from '../App.tsx';
import { timeAgo } from '../state.ts';

export function Dashboard({ stats, achievements, onClose, app }: { stats: Stats | null; achievements: Achievement[]; onClose: () => void; app: AppApi }) {
  const [sharing, setSharing] = useState(false);
  if (!stats) return null;
  const unlocked = achievements.filter((a) => a.unlocked).length;
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
        <section className="li-ach" data-testid="achievements">
          <div className="li-ach-head">
            <h4>Achievements <small>{unlocked} of {achievements.length} unlocked</small></h4>
            <button className="li-btn primary" onClick={() => setSharing((v) => !v)} data-testid="share-button"><Share2 size={15} /> Share my progress</button>
          </div>
          {sharing && <ShareCard stats={stats} achievements={achievements} toast={app.toast} />}
          <div className="li-ach-grid">
            {[...achievements].sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || b.current / b.target - a.current / a.target).map((a) => (
              <div key={a.id} className={`li-ach-item ${a.unlocked ? 'on' : ''} t-${a.tier}`} title={a.description}>
                <span className="li-ach-icon">{a.icon}</span>
                <div>
                  <b>{a.title}</b>
                  <small>{a.description}</small>
                  {!a.unlocked && <div className="li-gbar"><i style={{ width: `${(a.current / a.target) * 100}%` }} /></div>}
                  {!a.unlocked && <small className="li-muted">{a.current} / {a.target}</small>}
                </div>
              </div>
            ))}
          </div>
        </section>
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

function ShareCard({ stats, achievements, toast }: { stats: Stats; achievements: Achievement[]; toast: AppApi['toast'] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawProgressCard(ref.current, stats, achievements); }, [stats, achievements]);
  const blob = () => new Promise<Blob | null>((res) => ref.current?.toBlob(res, 'image/png') ?? res(null));
  const download = async () => {
    const b = await blob();
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `leonida-progress-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const copy = async () => {
    try {
      const b = await blob();
      if (!b || !('ClipboardItem' in window)) throw new Error('not supported');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
      toast('Image copied. Paste it into Facebook, Discord or Reddit.', 'success');
    } catch {
      toast('This browser can only download the image here (copying images needs HTTPS or localhost).');
    }
  };
  return (
    <div className="li-share">
      <canvas ref={ref} className="li-share-canvas" aria-label="Your progress card" data-testid="share-canvas" />
      <div className="li-row">
        <button className="li-btn primary" onClick={() => void download()}><Download size={15} /> Save image</button>
        <button className="li-btn" onClick={() => void copy()}><Copy size={15} /> Copy image</button>
        <span className="li-muted small">Made on this device. No spoilers on it, and nothing is uploaded.</span>
      </div>
    </div>
  );
}
