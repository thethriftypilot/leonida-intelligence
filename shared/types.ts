// Shared domain types used by the server, the research engine and the web client.

export type Verification = 'verified' | 'corroborated' | 'unconfirmed' | 'disputed' | 'outdated';
export const VERIFICATIONS: Verification[] = ['verified', 'corroborated', 'unconfirmed', 'disputed', 'outdated'];

/** How precisely the stored coordinate locates the discovery. */
export type Precision = 'marker' | 'venue' | 'area' | 'approximate' | 'unknown';

/**
 * none     – general exploration content (a building, a shop)
 * gameplay – reveals a gameplay mechanic/reward location but no narrative
 * story    – reveals missions, characters' story beats or narrative events
 * late     – late-game narrative content
 */
export type SpoilerLevel = 'none' | 'gameplay' | 'story' | 'late';

export type RecordStatus = 'active' | 'removed' | 'merged';

export interface SourceLink {
  label: string;
  url: string;
}

export interface MediaItem {
  url: string;
  kind: 'image';
  credit: string;
  license?: string;
}

/** Coordinates are GTADB GTA VI game units (≈ metres), x east, y north, origin at map centre. */
export interface LocationRecord {
  id: string;
  sourceId: string;
  sourceKey: string;
  name: string;
  group: string;
  category: string;
  subcategory: string | null;
  tags: string[];
  description: string | null;
  steps: string[];
  x: number | null;
  y: number | null;
  coordSystem: 'gtadb-vi';
  precision: Precision;
  region: string | null;
  neighborhood: string | null;
  address: string | null;
  availability: string | null;
  chapterMin: number | null;
  missable: boolean;
  characters: string | null;
  rewards: string | null;
  repeatable: boolean | null;
  enterable: boolean;
  media: MediaItem[];
  sourceUrl: string | null;
  sourceLabel: string | null;
  links: SourceLink[];
  evidence: string | null;
  verification: Verification;
  confidence: number;
  spoiler: SpoilerLevel;
  relatedId: string | null;
  firstSeen: string;
  updatedAt: string;
  version: number;
  status: RecordStatus;
  mergedInto: string | null;
  /** Set by the API when details are withheld by spoiler protection. */
  redacted?: boolean;
}

export interface Progress {
  locationId: string;
  visited: boolean;
  collected: boolean;
  completed: boolean;
  favorite: boolean;
  planned: boolean;
  notes: string;
  updatedAt: string;
  visitedAt: string | null;
  completedAt: string | null;
}

export type ProgressFlag = 'visited' | 'collected' | 'completed' | 'favorite' | 'planned';
export const PROGRESS_FLAGS: ProgressFlag[] = ['visited', 'collected', 'completed', 'favorite', 'planned'];

export interface CustomMarker {
  id: string;
  name: string;
  x: number;
  y: number;
  icon: string;
  color: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Checklist {
  id: string;
  name: string;
  createdAt: string;
  items: ChecklistItem[];
}

export interface ChecklistItem {
  id: string;
  checklistId: string;
  text: string;
  locationId: string | null;
  done: boolean;
  sort: number;
}

export interface SavedRoute {
  id: string;
  name: string;
  waypoints: string[];
  start: { x: number; y: number } | null;
  createdAt: string;
}

export interface SpoilerSettings {
  chapter: number;
  hideStory: boolean;
  hideLate: boolean;
  showUnknownChapter: boolean;
  /** Epoch ms until which spoilers are temporarily revealed (0 = not revealed). */
  revealUntil: number;
}

export const DEFAULT_SPOILERS: SpoilerSettings = {
  chapter: 0,
  hideStory: true,
  hideLate: true,
  showUnknownChapter: true,
  revealUntil: 0,
};

export interface ReviewItem {
  id: number;
  kind: 'lead' | 'unplaced' | 'possible-duplicate' | 'invalid-coordinates' | 'conflict' | 'import';
  sourceId: string;
  sourceKey: string;
  title: string;
  url: string | null;
  summary: string | null;
  suggestedGroup: string | null;
  payload: unknown;
  status: 'pending' | 'approved' | 'rejected' | 'dismissed';
  createdAt: string;
  resolvedAt: string | null;
  locationId: string | null;
}

export interface SourceInfo {
  id: string;
  name: string;
  kind: 'dataset' | 'leads' | 'import';
  description: string;
  homepage: string;
  license: string;
  attribution: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: 'ok' | 'unchanged' | 'error' | 'disabled' | 'never';
  lastError: string | null;
  revision: string | null;
  recordCount: number;
}

export interface SourceRunReport {
  sourceId: string;
  status: 'ok' | 'unchanged' | 'error' | 'skipped';
  revision: string | null;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  queued: number;
  rejected: number;
  error: string | null;
  durationMs: number;
  notes: string[];
}

export interface UpdateRun {
  id: number;
  trigger: 'schedule' | 'manual' | 'startup' | 'test';
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'partial' | 'error';
  sources: SourceRunReport[];
  summary: string;
}

export interface WorldMeta {
  regions: RegionInfo[];
  maxChapter: number;
  groups: GroupInfo[];
  layers: MapLayerInfo[];
}

export interface RegionInfo {
  name: string;
  x: number;
  y: number;
  count: number;
}

export interface GroupInfo {
  key: string;
  label: string;
  color: string;
  icon: string;
  categories: { key: string; label: string; count: number }[];
  count: number;
}

export interface MapLayerInfo {
  id: string;
  label: string;
  url: string;
  maxNativeZoom: number;
  attribution: string;
  installed: boolean;
  background: string;
}
