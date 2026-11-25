import { useEffect, useMemo, useState } from 'react';
import { Crosshair, Flag, MapPin, Play, SkipForward, Timer, Trophy, X, Route as RouteIcon, Check, Info } from 'lucide-react';
import type { LocationRecord, Progress, WorldMeta } from '../../../shared/types.ts';
import type { Settings } from '../api.ts';
import type { AppApi } from '../App.tsx';
import { GROUPS } from '../../../shared/categories.ts';
import { PLAYABLE_GROUPS, bearing, doneFlagFor, formatDuration, huntQueue, isHuntable, type Point } from '../../../shared/play.ts';
import { formatDistance } from '../../../shared/coords.ts';
import { loadLocal, saveLocal, PRECISION_LABEL } from '../state.ts';
import { GroupIcon } from '../icons.tsx';

interface Session {
  active: boolean;
  groups: string[];
  includeApprox: boolean;
  from: Point | null;
  startedAt: number;
  found: string[];
  skipped: string[];
  travelled: number;
  ended: boolean;
}

const KEY = 'li.play';
const DEFAULT: Session = { active: false, groups: ['collectibles', 'money', 'weapons', 'secrets'], includeApprox: false, from: null, startedAt: 0, found: [], skipped: [], travelled: 0, ended: false };

interface Props {
  locations: LocationRecord[];
  progress: Record<string, Progress>;
  settings: Settings | null;
  meta: WorldMeta | null;
  app: AppApi;
  pickedStart: { point: Point; nonce: number } | null;
  onPickStart: () => void;
  onClose: () => void;
}

export function PlayMode(p: Props) {
  const [s, setS] = useState<Session>(() => ({ ...DEFAULT, ...loadLocal(KEY, DEFAULT) }));
  const [now, setNow] = useState(Date.now());
  const [celebrate, setCelebrate] = useState<string | null>(null);
  const [startChoice, setStartChoice] = useState<string>(() => (p.settings?.myPosition ? 'me' : ''));
  const chapter = p.settings?.spoilers.chapter ?? 0;
  const update = (patch: Partial<Session>) => setS((cur) => { const n = { ...cur, ...patch }; saveLocal(KEY, n); return n; });

  useEffect(() => {
    if (!s.active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [s.active]);

  // A start point picked on the map.
  useEffect(() => {
    if (!p.pickedStart) return;
    update({ from: p.pickedStart.point });
    setStartChoice('picked');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pickedStart?.nonce]);

  const skipped = useMemo(() => new Set(s.skipped), [s.skipped]);
  const startPoint: Point | null = useMemo(() => {
    if (s.active && s.from) return s.from;
    if (startChoice === 'me') return p.settings?.myPosition ?? null;
    if (startChoice === 'picked') return s.from;
    const r = p.meta?.regions.find((x) => x.name === startChoice);
    return r ? { x: r.x, y: r.y } : null;
  }, [s.active, s.from, startChoice, p.settings?.myPosition, p.meta]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of p.locations) {
      if (isHuntable(l, p.progress, { groups: PLAYABLE_GROUPS, chapter, includeApprox: s.includeApprox })) c[l.group] = (c[l.group] ?? 0) + 1;
    }
    return c;
  }, [p.locations, p.progress, chapter, s.includeApprox]);

  const queue = useMemo(() => (s.active && startPoint
    ? huntQueue(p.locations, p.progress, { groups: s.groups, from: startPoint, chapter, skipped, includeApprox: s.includeApprox }, 4)
    : []), [s.active, startPoint, p.locations, p.progress, s.groups, chapter, skipped, s.includeApprox]);
  const target = queue[0] ?? null;

  // Keep the map on the current target and show only what is next.
  useEffect(() => {
    if (!s.active || !target) return;
    p.app.flyTo(target.loc.x!, target.loc.y!, 4.5);
    p.app.setHighlight(queue.map((q) => q.loc.id), 'Play Mode targets');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.active, target?.loc.id]);

  const start = () => {
    if (!startPoint) return;
    update({ active: true, ended: false, from: startPoint, startedAt: Date.now(), found: [], skipped: [], travelled: 0 });
  };

  const gotIt = async () => {
    if (!target) return;
    const l = target.loc;
    await p.app.setProgress(l.id, { visited: true, [doneFlagFor(l)]: true });
    setCelebrate(l.name);
    setTimeout(() => setCelebrate(null), 1600);
    update({ from: { x: l.x!, y: l.y! }, found: [...s.found, l.id], travelled: s.travelled + target.distance });
  };

  const skip = () => { if (target) update({ skipped: [...s.skipped, target.loc.id] }); };

  const end = () => {
    p.app.setHighlight(null);
    update({ active: false, ended: true });
  };

  const close = () => {
    if (s.active) p.app.setHighlight(null);
    p.onClose();
  };

  const elapsed = s.active ? now - s.startedAt : 0;
  const byId = useMemo(() => new Map(p.locations.map((l) => [l.id, l])), [p.locations]);

  return (
    <section className="li-play" aria-label="Play Mode" data-testid="play-mode">
      <div className="li-play-head">
        <div><div className="li-kicker">Guided hunt</div><h2><Play size={18} /> Play Mode</h2></div>
        <button className="li-icon-btn" onClick={close} aria-label="Close Play Mode"><X size={18} /></button>
      </div>

      {s.active ? (
        <>
          <div className="li-play-hud">
            <span title="Session time"><Timer size={15} /> {formatDuration(elapsed)}</span>
            <span title="Found this session" data-testid="play-found"><Check size={15} /> {s.found.length} found</span>
            <span title="Straight-line distance between your finds"><RouteIcon size={15} /> {formatDistance(s.travelled)}</span>
          </div>

          {celebrate && <div className="li-play-celebrate" role="status">+1 · {celebrate}</div>}

          {target ? (
            <div className="li-play-target" style={{ ['--g' as string]: GROUPS.find((g) => g.key === target.loc.group)?.color ?? '#ff5fa2' }} data-testid="play-target">
              <div className="li-play-cat"><GroupIcon group={target.loc.group} size={14} /> {target.loc.category}</div>
              <h3>{target.loc.name}</h3>
              <div className="li-play-dist">
                <span className="li-play-arrow" style={{ transform: `rotate(${s.from ? bearing(s.from, { x: target.loc.x!, y: target.loc.y! }).degrees : 0}deg)` }} aria-hidden>➤</span>
                <b>{formatDistance(target.distance)}</b>
                <span>{s.from ? bearing(s.from, { x: target.loc.x!, y: target.loc.y! }).label : ''}{target.loc.region ? ` · ${target.loc.region}` : ''}</span>
              </div>
              {target.loc.precision !== 'marker' && target.loc.precision !== 'venue' && <p className="li-play-note">{PRECISION_LABEL[target.loc.precision]}: search the area around the pin.</p>}
              {target.loc.description && <p className="li-play-desc">{target.loc.description.split('\n')[0].slice(0, 220)}</p>}
              {target.loc.steps.length > 0 && (
                <ol className="li-play-steps">{target.loc.steps.slice(0, 3).map((st, i) => <li key={i}>{st}</li>)}</ol>
              )}
              <div className="li-play-actions">
                <button className="li-btn primary big" onClick={() => void gotIt()} data-testid="play-got-it"><Check size={18} /> Got it</button>
                <button className="li-btn" onClick={skip} data-testid="play-skip"><SkipForward size={16} /> Skip</button>
                <button className="li-btn" onClick={() => p.app.select(target.loc.id, true)}><Info size={16} /> Details</button>
              </div>
              {queue.length > 1 && (
                <div className="li-play-next">
                  <div className="li-kicker">Up next</div>
                  {queue.slice(1).map((q) => <div key={q.loc.id}><span>{q.loc.name}</span><small>{formatDistance(q.distance)}</small></div>)}
                </div>
              )}
            </div>
          ) : (
            <div className="li-play-empty">
              <Trophy size={32} />
              <p><b>Nothing left to hunt</b> in these categories at your story progress. Pick more categories or end the session.</p>
            </div>
          )}
          <button className="li-btn danger wide" onClick={end} data-testid="play-end"><Flag size={16} /> End session</button>
          <p className="li-muted small">Distances are straight lines. There is no licensed road map of Leonida.</p>
        </>
      ) : (
        <>
          {s.ended && s.found.length > 0 && (
            <div className="li-play-summary" data-testid="play-summary">
              <Trophy size={28} />
              <div>
                <b>Session complete: {s.found.length} found</b>
                <div className="li-muted small">{formatDistance(s.travelled)} covered</div>
                <div className="small">{s.found.slice(-5).map((id) => byId.get(id)?.name).filter(Boolean).join(' · ')}</div>
              </div>
            </div>
          )}
          <p className="li-play-intro">Pick what you're after. Play Mode always points you at the <b>nearest place you haven't finished</b>, and skips anything your story progress hasn't unlocked yet. Keep it open on your phone while you play.</p>
          <h4>What are you hunting?</h4>
          <div className="li-row wrap">
            {PLAYABLE_GROUPS.map((k) => {
              const g = GROUPS.find((x) => x.key === k);
              if (!g || !counts[k]) return null;
              const on = s.groups.includes(k);
              return (
                <button key={k} className={`li-chip ${on ? 'active' : ''}`} style={on ? { borderColor: g.color } : undefined} aria-pressed={on}
                  onClick={() => update({ groups: on ? s.groups.filter((x) => x !== k) : [...s.groups, k] })}>
                  <GroupIcon group={k} size={13} /> {g.label} <small>{counts[k]}</small>
                </button>
              );
            })}
          </div>
          <h4>Where are you starting?</h4>
          <div className="li-row wrap">
            <select aria-label="Start point" value={startChoice} onChange={(e) => { setStartChoice(e.target.value); if (e.target.value === 'pick') { setStartChoice(''); p.onPickStart(); } }} data-testid="play-start-select">
              <option value="">Choose…</option>
              {p.settings?.myPosition && <option value="me">Where I last said I am</option>}
              {s.from && startChoice === 'picked' && <option value="picked">The spot I picked</option>}
              <option value="pick">Pick a spot on the map…</option>
              {(p.meta?.regions ?? []).map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
            <button className="li-btn small" onClick={p.onPickStart}><MapPin size={14} /> Pick on map</button>
          </div>
          <label className="li-check"><input type="checkbox" checked={s.includeApprox} onChange={(e) => update({ includeApprox: e.target.checked })} /> Include places whose position is only an area</label>
          <button className="li-btn primary big wide" disabled={!startPoint || !s.groups.some((g) => counts[g])} onClick={start} data-testid="play-start">
            <Crosshair size={18} /> Start hunting
          </button>
        </>
      )}
    </section>
  );
}
