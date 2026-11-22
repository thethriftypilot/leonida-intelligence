import type { NormalizedRecord } from '../worldRepo.ts';

export interface Lead {
  key: string;
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string | null;
  suggestedGroup: string | null;
  feed: string;
}

export interface AdapterContext {
  dataDir: string;
  seedDir: string;
  offline: boolean;
  previousRevision: string | null;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  http: Http;
  log: (msg: string) => void;
  /** True when this source has never produced records (first import). */
  firstRun: boolean;
}

export interface AdapterResult {
  revision: string | null;
  unchanged?: boolean;
  /** When true, records form the complete upstream set and missing keys are treated as removed. */
  snapshot: boolean;
  records: NormalizedRecord[];
  leads: Lead[];
  notes: string[];
  state?: Record<string, unknown>;
}

export interface SourceAdapter {
  id: string;
  name: string;
  kind: 'dataset' | 'leads' | 'import';
  description: string;
  homepage: string;
  license: string;
  attribution: string;
  defaultEnabled: boolean;
  defaultConfig: Record<string, unknown>;
  run(ctx: AdapterContext): Promise<AdapterResult>;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export type Http = (url: string, init?: { headers?: Record<string, string>; timeoutMs?: number }) => Promise<HttpResponse>;
