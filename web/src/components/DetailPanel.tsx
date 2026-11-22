import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, X, MapPinned, Route as RouteIcon } from 'lucide-react';
import type { LocationRecord, Progress, ProgressFlag, Verification } from '../../../shared/types.ts';
import { api } from '../api.ts';
import type { AppApi } from '../App.tsx';
import { GroupIcon } from '../icons.tsx';
import { GROUP_BY_KEY } from '../../../shared/categories.ts';
import { chapterLabel } from '../../../shared/spoilers.ts';
import { PRECISION_LABEL, VERIFICATION_LABEL, timeAgo } from '../state.ts';
import type { ToolId } from './ToolsPanel.tsx';

interface Props {
  loc: LocationRecord;
  progress: Progress | undefined;
  app: AppApi;
  maxChapter: number;
  inRoute: boolean;
  onToggleRoute: () => void;
  onClose: () => void;
  backToTool: ToolId | null;
}

const FLAGS: { key: ProgressFlag; label: string; icon: string }[] = [
  { key: 'visited', label: 'Visited', icon: '👣' },
  { key: 'collected', label: 'Collected', icon: '💎' },
  { key: 'completed', label: 'Completed', icon: '✅' },
  { key: 'favorite', label: 'Favourite', icon: '⭐' },
  { key: 'planned', label: 'Plan to visit', icon: '📌' },
];

export function DetailPanel({ loc, progress, app, maxChapter, inRoute, onToggleRoute, onClose, backToTool }: Props) {
  const [notes, setNotes] = useState(progress?.notes ?? '');
  const [saved, setSaved] = useState(true);
  const [history, setHistory] = useState<{ change: string; at: string }[]>([]);
  const [related, setRelated] = useState<{ id: string; name: string } | null>(null);
  const [imgOk, setImgOk] = useState(true);
  const g = GROUP_BY_KEY[loc.group];

  useEffect(() => {
    api.location(loc.id).then((d) => { setHistory(d.history); setRelated(d.related); }).catch(() => undefined);
  }, [loc.id, loc.version]);

  useEffect(() => {
    if (saved) return;
    const t = setTimeout(async () => { await app.setProgress(loc.id, { notes }); setSaved(true); }, 800);
    return () => clearTimeout(t);
  }, [notes, saved, app, loc.id]);

  const toggle = (f: ProgressFlag) => app.setProgress(loc.id, { [f]: !(progress?.[f] ?? false) });
  const setVerdict = async (v: Verification | null) => {
    try {
      await api.setVerification(loc.id, v, v === 'verified' ? 'Confirmed in-game by me' : v === 'disputed' ? 'Not found in-game by me' : undefined);
      await app.reload();
      app.toast(v ? `Marked as ${VERIFICATION_LABEL[v].toLowerCase()} (your verdict).` : 'Your verdict was cleared.', 'success');
    } catch (e) { app.toast((e as Error).message, 'error'); }
  };

  return (
    <div className="li-panel" data-testid="detail-panel">
      <div className="li-panel-head" style={{ ['--c' as string]: g?.color ?? '#999' }}>
        {backToTool && <button className="li-icon-btn" onClick={() => app.select(null)} aria-label="Back"><ArrowLeft size={18} /></button>}
        <div className="li-head-icon"><GroupIcon group={loc.group} size={20} /></div>
        <div className="li-head-text">
          <div className="li-kicker">{g?.label} · {loc.category}{loc.subcategory ? ` · ${loc.subcategory}` : ''}</div>
          <h2 data-testid="detail-title">{loc.name}</h2>
        </div>
        <button className="li-icon-btn" onClick={onClose} aria-label="Close details"><X size={18} /></button>
      </div>
      <div className="li-panel-body">
        <div className="li-badges">
          <span className={`li-badge-v v-${loc.verification}`} title="Verification status">{VERIFICATION_LABEL[loc.verification]}</span>
          <span className="li-badge-plain" title="Confidence score from evidence quality">Confidence {Math.round(loc.confidence * 100)}%</span>
          <span className="li-badge-plain">{PRECISION_LABEL[loc.precision] ?? loc.precision}</span>
          {loc.missable && <span className="li-badge-warn">Possibly missable</span>}
          {loc.enterable && <span className="li-badge-plain">Enterable</span>}
          {loc.redacted && <span className="li-badge-warn">Details spoiler-protected</span>}
        </div>

        <div className="li-progress-btns" role="group" aria-label="My progress">
          {FLAGS.map((f) => (
            <button key={f.key} data-testid={`flag-${f.key}`} aria-pressed={!!progress?.[f.key]} className={progress?.[f.key] ? 'on' : ''} onClick={() => toggle(f.key)}>
              <span aria-hidden>{f.icon}</span>{f.label}
            </button>
          ))}
        </div>

        {loc.description && <p className="li-desc">{loc.description}</p>}
        {loc.steps.length > 0 && (
          <>
            <h4>How to get it</h4>
            <ol className="li-steps">{loc.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </>
        )}

        <dl className="li-facts">
          <dt>Location</dt><dd>{[loc.neighborhood, loc.region].filter(Boolean).join(', ') || '—'}{loc.address && loc.address !== loc.name ? <div className="li-muted small">{loc.address}</div> : null}</dd>
          <dt>Map position</dt><dd>{loc.x !== null ? `x ${loc.x.toFixed(0)}, y ${loc.y!.toFixed(0)}` : 'Unknown — in research queue'}</dd>
          <dt>Story chapter</dt><dd>{loc.chapterMin !== null ? chapterLabel(loc.chapterMin, maxChapter) : loc.spoiler === 'none' ? 'General location — no known story restriction' : <span className="li-unknown">Unknown chapter requirement</span>}</dd>
          {loc.availability && <><dt>Availability</dt><dd>{loc.availability}</dd></>}
          {loc.characters && <><dt>Character</dt><dd>{loc.characters}</dd></>}
          {loc.rewards && <><dt>Reported reward</dt><dd>{loc.rewards}</dd></>}
          {loc.repeatable !== null && <><dt>Repeatable</dt><dd>{loc.repeatable ? 'Yes' : 'No'}</dd></>}
          <dt>Source</dt><dd>{loc.sourceUrl ? <a href={loc.sourceUrl} target="_blank" rel="noopener noreferrer">{loc.sourceLabel ?? loc.sourceUrl} <ExternalLink size={12} /></a> : loc.sourceLabel ?? '—'}</dd>
          <dt>First seen</dt><dd>{new Date(loc.firstSeen).toLocaleString()}</dd>
          <dt>Updated</dt><dd>{timeAgo(loc.updatedAt)} (v{loc.version})</dd>
        </dl>

        {loc.media.length > 0 && imgOk && (
          <figure className="li-media">
            <img src={loc.media[0].url} alt={`In-game view of ${loc.name}`} loading="lazy" onError={() => setImgOk(false)} />
            <figcaption>{loc.media[0].credit}{loc.media[0].license ? ` · ${loc.media[0].license}` : ''}</figcaption>
          </figure>
        )}

        {loc.evidence && (
          <>
            <h4>Evidence</h4>
            <p className="li-muted">{loc.evidence}</p>
          </>
        )}
        {loc.links.length > 0 && (
          <ul className="li-links">
            {loc.links.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label} <ExternalLink size={12} /></a></li>)}
          </ul>
        )}
        {related && <p className="li-muted">Venue: <button className="li-link" onClick={() => app.select(related.id, true)}>{related.name}</button></p>}

        <h4>My notes</h4>
        <textarea data-testid="notes" className="li-notes" rows={4} value={notes} placeholder="Anything worth remembering…" onChange={(e) => { setNotes(e.target.value); setSaved(false); }} />
        <div className="li-muted small">{saved ? 'Saved to server' : 'Saving…'}</div>

        <div className="li-row li-wrap">
          {loc.x !== null && <button className="li-btn" onClick={() => app.flyTo(loc.x!, loc.y!, 6)}><MapPinned size={14} /> Zoom to</button>}
          {loc.x !== null && <button className="li-btn" onClick={onToggleRoute}><RouteIcon size={14} /> {inRoute ? 'Remove from route' : 'Add to route'}</button>}
          {loc.x === null && !loc.redacted && <button className="li-btn" onClick={() => app.startPick({ kind: 'placeItem', id: loc.id })}>I found it — place on map</button>}
          {loc.tags.includes('placed-by-you') && <button className="li-btn" onClick={async () => { await api.clearPosition(loc.id); await app.reload(); }}>Remove my placement</button>}
        </div>

        <h4>Your verdict</h4>
        <p className="li-muted small">“Verified” is reserved for things you confirmed yourself in-game. Your verdict survives research updates.</p>
        <div className="li-row li-wrap">
          <button className="li-btn" onClick={() => setVerdict('verified')}>✔ I confirmed this in-game</button>
          <button className="li-btn" onClick={() => setVerdict('disputed')}>✖ Not there</button>
          <button className="li-btn ghost" onClick={() => setVerdict(null)}>Clear verdict</button>
        </div>

        {history.length > 0 && (
          <details className="li-history">
            <summary>Change history ({history.length})</summary>
            <ul>{history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} — {h.change}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
  );
}
