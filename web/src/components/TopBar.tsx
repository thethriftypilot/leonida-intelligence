import { useEffect, useRef, useState } from 'react';
import { Search, ShieldCheck, ShieldOff, RefreshCw, LayoutDashboard, Shuffle, Maximize, Menu, Wrench } from 'lucide-react';
import type { LocationRecord, WorldMeta, SpoilerSettings } from '../../../shared/types.ts';
import type { Settings, Stats } from '../api.ts';
import type { AppApi } from '../App.tsx';
import { chapterLabel } from '../../../shared/spoilers.ts';
import { normalizeText } from '../../../shared/search.ts';
import { timeAgo } from '../state.ts';

interface Props {
  meta: WorldMeta | null;
  settings: Settings | null;
  stats: Stats | null;
  updating: boolean;
  revealActive: boolean;
  revealUntil: number;
  hiddenCount: number;
  locations: LocationRecord[];
  app: AppApi;
  onToggleLeft: () => void;
  onSettings: (patch: { spoilers?: Partial<SpoilerSettings> }) => void;
  onReveal: (minutes: number) => void;
  onUpdate: () => void;
  onDashboard: () => void;
  onSurprise: () => void;
  onFullscreen: () => void;
}

export function TopBar(p: Props) {
  const [q, setQ] = useState('');
  const [suggest, setSuggest] = useState<LocationRecord[]>([]);
  const [spoilerOpen, setSpoilerOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const sp = p.settings?.spoilers;
  const maxCh = Math.max(p.meta?.maxChapter ?? 5, sp?.chapter ?? 0);

  useEffect(() => {
    const t = normalizeText(q);
    if (t.length < 2) { setSuggest([]); return; }
    // Suggestions come only from records the server already released under spoiler protection.
    const res = p.locations.filter((l) => l.category !== 'Unnamed buildings' && normalizeText(l.name).includes(t)).slice(0, 8);
    setSuggest(res);
  }, [q, p.locations]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setSuggest([]); setSpoilerOpen(false); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const submit = () => {
    if (!q.trim()) return;
    setSuggest([]);
    (window as unknown as { __liSearch?: string }).__liSearch = q;
    p.app.openTool('search');
    window.dispatchEvent(new CustomEvent('li-search', { detail: q }));
  };

  const last = p.stats?.lastSuccessfulUpdate ?? null;

  return (
    <header className="li-top" ref={boxRef}>
      <button className="li-icon-btn li-menu" onClick={p.onToggleLeft} aria-label="Toggle filters"><Menu size={20} /></button>
      <div className="li-brand" title="Unofficial fan-made companion. Not affiliated with Rockstar Games.">
        <span className="li-logo">LEONIDA</span><span className="li-logo2">INTELLIGENCE</span>
      </div>
      <div className="li-search">
        <Search size={16} />
        <input
          id="li-search" data-testid="search-input" placeholder='Search or ask: "free gun early", "hidden cash near Vice City"…'
          value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          aria-label="Search locations"
        />
        {suggest.length > 0 && (
          <ul className="li-suggest" role="listbox">
            {suggest.map((l) => (
              <li key={l.id}><button onClick={() => { setSuggest([]); setQ(l.name); p.app.select(l.id, true); }}>
                <span>{l.name}</span><small>{l.category}{l.region ? ` · ${l.region}` : ''}</small>
              </button></li>
            ))}
            <li><button className="li-suggest-all" onClick={submit}>Search everything for “{q}” →</button></li>
          </ul>
        )}
      </div>
      <label className="li-chapter" title="Your current story progress">
        <span>Progress</span>
        <select data-testid="chapter-select" value={sp?.chapter ?? 0} onChange={(e) => p.onSettings({ spoilers: { chapter: Number(e.target.value) } })}>
          {Array.from({ length: maxCh + 1 }, (_, i) => <option key={i} value={i}>{chapterLabel(i, maxCh)}</option>)}
          <option value={99}>Story complete</option>
        </select>
      </label>
      <div className="li-spoiler-wrap">
        <button data-testid="spoiler-button" className={`li-pill ${p.revealActive ? 'warn' : sp?.hideStory ? 'safe' : 'warn'}`} onClick={() => setSpoilerOpen((v) => !v)} aria-expanded={spoilerOpen}>
          {p.revealActive || !sp?.hideStory ? <ShieldOff size={16} /> : <ShieldCheck size={16} />}
          <span>{p.revealActive ? 'Revealed' : sp?.hideStory ? 'Spoilers hidden' : 'Spoilers shown'}</span>
          {p.hiddenCount > 0 && <span className="li-count">{p.hiddenCount}</span>}
        </button>
        {spoilerOpen && sp && (
          <div className="li-popover" data-testid="spoiler-panel">
            <h3>Spoiler protection</h3>
            <p className="li-muted">{p.hiddenCount} entries are currently withheld by the server — they never reach this browser, so search and suggestions can't leak them.</p>
            <label className="li-check"><input type="checkbox" checked={sp.hideStory} onChange={(e) => p.onSettings({ spoilers: { hideStory: e.target.checked } })} /> Hide story content beyond my chapter</label>
            <label className="li-check"><input type="checkbox" checked={sp.hideLate} onChange={(e) => p.onSettings({ spoilers: { hideLate: e.target.checked } })} /> Hide late-game narrative secrets</label>
            <label className="li-check"><input type="checkbox" checked={sp.showUnknownChapter} onChange={(e) => p.onSettings({ spoilers: { showUnknownChapter: e.target.checked } })} /> Show items whose chapter requirement is unknown (clearly marked)</label>
            <p className="li-muted small">Gameplay locations (shops, collectibles, bank jobs) unlocked in a later chapter stay on the map, but their descriptions are hidden until you reach that chapter.</p>
            {p.revealActive ? (
              <button className="li-btn" onClick={() => p.onReveal(0)}>Hide spoilers now</button>
            ) : (
              <button className="li-btn danger" data-testid="reveal-button" onClick={() => { if (confirm('Temporarily reveal ALL story spoilers on this device for 10 minutes?')) { p.onReveal(10); setSpoilerOpen(false); } }}>Reveal spoilers for 10 minutes…</button>
            )}
          </div>
        )}
      </div>
      <div className="li-top-actions">
        <button className="li-pill" onClick={p.onSurprise} title="Surprise me: a random accessible, unfinished discovery"><Shuffle size={16} /><span>Surprise me</span></button>
        <button className="li-pill" onClick={() => p.app.openTool('useful')} title="Smart tools"><Wrench size={16} /><span>Tools</span></button>
        <button className="li-pill" data-testid="update-button" onClick={p.onUpdate} disabled={p.updating} title={`Last successful research update: ${timeAgo(last)}`}>
          <RefreshCw size={16} className={p.updating ? 'spin' : ''} /><span>{p.updating ? 'Updating…' : 'Check for updates'}</span>
        </button>
        <button className="li-icon-btn" onClick={p.onDashboard} aria-label="Dashboard" title="Dashboard"><LayoutDashboard size={18} /></button>
        <button className="li-icon-btn" onClick={p.onFullscreen} aria-label="Full screen" title="Full screen (F)"><Maximize size={18} /></button>
      </div>
    </header>
  );
}
