import type {
  Checklist, CustomMarker, LocationRecord, Progress, ReviewItem, SavedRoute, SourceInfo, SourceRunReport,
  SpoilerSettings, UpdateRun, Verification, WorldMeta,
} from '../../shared/types.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

/** A random id for this browser tab, so live-sync events it caused itself can be ignored. */
export const DEVICE_ID = Math.random().toString(36).slice(2, 12);

export interface LiveEvent { channel: 'progress' | 'markers' | 'checklists' | 'routes' | 'settings' | 'world'; id?: string; device?: string }

/** Listen for changes made on other devices. Returns an unsubscribe function. */
export function subscribeLive(onEvent: (e: LiveEvent) => void, onState?: (connected: boolean) => void): () => void {
  if (typeof EventSource === 'undefined') return () => undefined;
  const es = new EventSource('/api/events');
  es.onopen = () => onState?.(true);
  es.onerror = () => onState?.(false);
  es.onmessage = (m) => {
    try {
      const e = JSON.parse(m.data) as LiveEvent;
      if (e.device !== DEVICE_ID) onEvent(e);
    } catch { /* ignore malformed */ }
  };
  return () => es.close();
}

let revealActive = () => false;
export function setRevealProvider(fn: () => boolean): void {
  revealActive = fn;
}

async function req<T>(method: string, url: string, body?: unknown, opts: { reveal?: boolean } = {}): Promise<T> {
  let u = url;
  if (opts.reveal !== false && method === 'GET' && revealActive()) u += (u.includes('?') ? '&' : '?') + 'reveal=1';
  const res = await fetch(u, {
    method,
    headers: { 'X-LI-Client': '1', 'X-LI-Device': DEVICE_ID, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export interface Settings {
  spoilers: SpoilerSettings;
  updateIntervalHours: number;
  myPosition: { x: number; y: number } | null;
  nextUpdateAt: string | null;
}

export interface Stats {
  totalLocations: number; mapped: number; unplaced: number; visibleLocations: number; hiddenBySpoilers: number;
  verified: number; corroborated: number; unconfirmed: number; disputed: number; addedThisWeek: number;
  trackable: number; completed: number; completionPct: number; visited: number; unvisited: number; favorites: number; planned: number;
  groups: { key: string; label: string; color: string; total: number; done: number; visited: number }[];
  lastSuccessfulUpdate: string | null; lastRun: UpdateRun | null; nextUpdateAt: string | null; updating: boolean;
  sources: SourceInfo[]; reviewPending: Record<string, number>;
}

export interface BriefHit { id: string; name: string; group: string; category: string; distance?: number | null; score?: number }

export const api = {
  session: () => req<{ pinRequired: boolean; authenticated: boolean }>('GET', '/api/session'),
  login: (pin: string) => req<{ ok: boolean }>('POST', '/api/login', { pin }),
  meta: () => req<WorldMeta>('GET', '/api/meta'),
  locations: () => req<{ locations: LocationRecord[]; hiddenCount: number }>('GET', '/api/locations'),
  location: (id: string) => req<{ location: LocationRecord; progress: Progress | null; history: { change: string; diff: unknown; at: string }[]; related: { id: string; name: string } | null }>('GET', `/api/locations/${encodeURIComponent(id)}`),
  setVerification: (id: string, verification: Verification | null, note?: string) => req('POST', `/api/locations/${encodeURIComponent(id)}/verification`, { verification, note }),
  setPosition: (id: string, x: number, y: number) => req('POST', `/api/locations/${encodeURIComponent(id)}/position`, { x, y }),
  clearPosition: (id: string) => req('POST', `/api/locations/${encodeURIComponent(id)}/position`, { clear: true }),
  progress: () => req<Record<string, Progress>>('GET', '/api/progress'),
  setProgress: (id: string, patch: Partial<Progress>) => req<Progress>('PUT', `/api/progress/${encodeURIComponent(id)}`, patch),
  activity: () => req<{ recentlyCompleted: Progress[]; recentlyVisited: Progress[] }>('GET', '/api/activity'),
  search: (q: string) => req<{ interpretation: string[]; fallback: boolean; near: { name: string } | null; results: BriefHit[] }>('GET', `/api/search?q=${encodeURIComponent(q)}`),
  recommendations: () => req<{ recommendations: (BriefHit & { reasons: string[] })[] }>('GET', '/api/recommendations'),
  nearby: (x: number, y: number, radius: number, groups: string[] | null, hideDone: boolean) =>
    req<{ results: BriefHit[] }>('GET', `/api/nearby?x=${x}&y=${y}&radius=${radius}&hideDone=${hideDone ? 1 : 0}${groups ? `&groups=${groups.join(',')}` : ''}`),
  recent: (days: number) => req<{ results: (BriefHit & { discoveredAt: string; sourceId: string })[] }>('GET', `/api/recent?days=${days}`),
  markers: () => req<CustomMarker[]>('GET', '/api/markers'),
  saveMarker: (m: Partial<CustomMarker>) => req<CustomMarker>('POST', '/api/markers', m),
  deleteMarker: (id: string) => req('DELETE', `/api/markers/${id}`),
  checklists: () => req<Checklist[]>('GET', '/api/checklists'),
  createChecklist: (name: string) => req<Checklist>('POST', '/api/checklists', { name }),
  deleteChecklist: (id: string) => req('DELETE', `/api/checklists/${id}`),
  addChecklistItem: (id: string, text: string, locationId?: string) => req('POST', `/api/checklists/${id}/items`, { text, locationId }),
  updateChecklistItem: (id: string, patch: { done?: boolean; text?: string }) => req('PUT', `/api/checklist-items/${id}`, patch),
  deleteChecklistItem: (id: string) => req('DELETE', `/api/checklist-items/${id}`),
  routes: () => req<SavedRoute[]>('GET', '/api/routes'),
  saveRoute: (r: { id?: string; name: string; waypoints: string[]; start: { x: number; y: number } | null }) => req<SavedRoute>('POST', '/api/routes', r),
  deleteRoute: (id: string) => req('DELETE', `/api/routes/${id}`),
  settings: () => req<Settings>('GET', '/api/settings'),
  saveSettings: (s: Partial<Omit<Settings, 'spoilers'>> & { spoilers?: Partial<SpoilerSettings> }) => req<Settings>('PUT', '/api/settings', s),
  stats: () => req<Stats>('GET', '/api/stats'),
  sources: () => req<SourceInfo[]>('GET', '/api/sources'),
  sourceConfig: (id: string) => req<Record<string, unknown>>('GET', `/api/sources/${id}/config`),
  updateSource: (id: string, patch: { enabled?: boolean; config?: unknown }) => req('PUT', `/api/sources/${id}`, patch),
  updates: () => req<{ running: boolean; currentRunId: number | null; runs: UpdateRun[]; nextUpdateAt: string | null }>('GET', '/api/updates'),
  updateDetail: (id: number) => req<{ run: UpdateRun; changes: { location_id: string; change: string; name: string | null }[] }>('GET', `/api/updates/${id}`),
  runUpdate: () => req<{ started: boolean; runId: number | null }>('POST', '/api/updates/run', {}),
  review: (status = 'pending', kind = '') => req<{ items: ReviewItem[]; counts: Record<string, number> }>('GET', `/api/review?status=${status}&kind=${kind}`),
  resolveReview: (id: number, body: { action: 'approve' | 'reject' | 'dismiss'; x?: number; y?: number; name?: string; group?: string; category?: string }) => req<{ ok: boolean; locationId?: string }>('POST', `/api/review/${id}`, body),
  importData: (body: { data: unknown; format: 'game' | 'normalized'; sourceLabel: string; sourceUrl?: string }) => req<SourceRunReport>('POST', '/api/import', body),
  exportUrl: '/api/backup/export',
  restore: (backup: unknown, mode: 'replace' | 'merge') => req<{ ok: boolean; counts: Record<string, number> }>('POST', '/api/backup/restore', { backup, mode }),
  backups: () => req<{ user: { name: string; size: number; createdAt: string }[]; world: { name: string; size: number; createdAt: string }[] }>('GET', '/api/backups'),
  createBackup: () => req<{ name: string }>('POST', '/api/backups', {}),
  restoreBackup: (name: string) => req('POST', `/api/backups/${encodeURIComponent(name)}/restore`, {}),
  restoreSnapshot: (name: string) => req('POST', `/api/snapshots/${encodeURIComponent(name)}/restore`, {}),
};
