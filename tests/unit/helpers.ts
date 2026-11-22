import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ROOT_DIR, type AppConfig } from '../../server/config.ts';
import { buildApp, type BuildOptions } from '../../server/app.ts';
import type { SourceAdapter } from '../../server/ingest/types.ts';
import type { NormalizedRecord } from '../../server/worldRepo.ts';

export function tempDir(prefix = 'li-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function testConfig(dataDir: string, o: Partial<AppConfig> = {}): AppConfig {
  return loadConfig({
    dataDir, offline: true, schedulerEnabled: false, accessPin: null, allowPublicIps: false,
    tilesDir: path.join(dataDir, 'no-tiles'), webDir: path.join(dataDir, 'no-web'), seedDir: path.join(ROOT_DIR, 'seed'),
    ...o,
  });
}

export async function startApp(dataDir: string, cfg: Partial<AppConfig> = {}, opts: BuildOptions = {}) {
  return buildApp(testConfig(dataDir, cfg), { logger: false, startScheduler: false, ...opts });
}

export const H = { 'x-li-client': '1', 'content-type': 'application/json' };

export function rec(key: string, o: Partial<NormalizedRecord> = {}): NormalizedRecord {
  return {
    sourceKey: key, name: `Place ${key}`, group: 'collectibles', category: 'Test items', subcategory: null, tags: [],
    description: `Description of ${key}`, steps: [], x: -3000, y: 1000, precision: 'venue', region: 'Vice City', neighborhood: null,
    address: null, availability: null, chapterMin: null, missable: false, characters: null, rewards: null, repeatable: null,
    enterable: false, media: [], sourceUrl: `https://example.org/${key}`, sourceLabel: 'Test source', links: [],
    evidence: 'test', verification: 'corroborated', confidence: 0.8, spoiler: 'none', relatedId: null, ...o,
  };
}

/** A controllable in-memory adapter for engine tests. */
export function fakeAdapter(id: string, behaviour: { records?: NormalizedRecord[]; fail?: string; revision?: string; snapshot?: boolean }): SourceAdapter & { behaviour: typeof behaviour } {
  const a = {
    id, name: `Fake ${id}`, kind: 'dataset' as const, description: 'test', homepage: 'https://example.org', license: 'test',
    attribution: 'test', defaultEnabled: true, defaultConfig: {}, behaviour,
    async run() {
      if (a.behaviour.fail) throw new Error(a.behaviour.fail);
      return { revision: a.behaviour.revision ?? null, snapshot: a.behaviour.snapshot ?? true, records: structuredClone(a.behaviour.records ?? []), leads: [], notes: [] };
    },
  };
  return a;
}
