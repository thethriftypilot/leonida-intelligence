import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../../server/config.ts';
import { normalizeGtadb, parseGtadbLandmarks } from '../../server/ingest/gtadb.ts';
import { parseLootFiles, chaptersMentioned } from '../../server/ingest/lootmap.ts';
import { parseFeed, classifyTitle } from '../../server/ingest/rss.ts';
import { parseImportPayload, buildImportCandidates } from '../../server/ingest/manualImport.ts';
import { findDuplicate, nameSimilarity } from '../../server/ingest/dedupe.ts';
import type { LocationRecord } from '../../shared/types.ts';

const seed = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'seed', f), 'utf8'));

test('GTADB: real seed parses into thousands of attributed records', () => {
  const { records, notes } = parseGtadbLandmarks(seed('gtadb/landmarks.json'));
  assert.ok(records.length > 3500, `got ${records.length}`);
  const joh = records.find((r) => r.name === 'Jack of Hearts');
  assert.ok(joh, 'Jack of Hearts present');
  assert.equal(joh!.sourceUrl, `https://map.gtadb.org/#VI,${joh!.sourceKey}`);
  assert.equal(joh!.region, 'Vice City');
  const guns = records.filter((r) => r.group === 'weapons');
  assert.ok(guns.length >= 3, 'gun stores mapped to Weapons');
  assert.ok(records.every((r) => r.x === null || (Number.isFinite(r.x) && Number.isFinite(r.y))));
  assert.ok(notes.some((n) => n.includes('duplicates skipped')));
});

test('GTADB: name/verification rules', () => {
  const base: [string, number[], number[], string, number[], number[], string[], string, number[]] = ['?, Ocean Beach, Vice Beach', [1, 2], [], '', [], [], ['hotel'], 'fff', [1, 1, 1]];
  const unknown = normalizeGtadb('L1', base);
  assert.ok(!('skip' in unknown));
  if ('skip' in unknown) return;
  assert.equal(unknown.category, 'Unnamed buildings');
  assert.equal(unknown.verification, 'unconfirmed');
  const named = normalizeGtadb('L2', ['Hotel X, Ocean Beach, Vice Beach', [1, 2], [100, 100], '', [], [], ['hotel'], 'fff', [1, 1, 1]]);
  assert.ok(!('skip' in named) && named.verification === 'corroborated' && named.media.length === 1);
  const unsure = normalizeGtadb('L3', ['Hotel Y?, Vice Beach', [1, 2], [100, 100], '', [], [], ['hotel'], 'fff', [1, 1, 1]]);
  assert.ok(!('skip' in unsure) && unsure.verification === 'unconfirmed' && unsure.name === 'Hotel Y');
  const disputed = normalizeGtadb('L4', ['Thing, Vice Beach', [1, 2], [100, 100], '', [], [], ['//may-not-exist'], 'fff', [1, 1, 1]]);
  assert.ok(!('skip' in disputed) && disputed.verification === 'disputed');
  const dup = normalizeGtadb('L5', ['Thing, Vice Beach', [1, 2], [], '', [], [], ['//duplicate-of-12'], 'fff', [1, 1, 1]]);
  assert.ok('skip' in dup);
  const nocoord = normalizeGtadb('L6', ['Thing, Vice Beach', [], [], '', [], [], [], 'fff', [1, 1, 1]]);
  assert.ok(!('skip' in nocoord) && nocoord.x === null && nocoord.precision === 'unknown');
});

test('GTADB: format change is detected instead of wiping data', () => {
  assert.throws(() => parseGtadbLandmarks([]), /unexpected JSON shape/);
  assert.throws(() => parseGtadbLandmarks({ L1: ['x'] }), /upstream format may have changed/);
});

test('Loot Map: guides and missions normalise with chapters, spoilers and positions', () => {
  const files = Object.fromEntries(['guides.json', 'collectible-guides.json', 'guide-positions.json', 'missions.json', 'mission-positions.json'].map((f) => [f, seed(`lootmap/${f}`)]));
  const { records } = parseLootFiles(files as never);
  assert.ok(records.length > 200);
  const prologue = records.find((r) => r.sourceKey === 'mission-prologue')!;
  assert.equal(prologue.chapterMin, 0);
  assert.equal(prologue.spoiler, 'story');
  assert.ok(records.some((r) => r.group === 'story' && r.spoiler === 'late'));
  const bank = records.find((r) => r.sourceKey === 'guide-job-key-lento-fleeca')!;
  assert.equal(bank.group, 'money');
  assert.equal(bank.chapterMin, 3);
  assert.equal(bank.precision, 'marker');
  assert.equal(bank.verification, 'corroborated');
  assert.ok(bank.sourceUrl?.startsWith('https://'));
  const unplaced = records.filter((r) => r.x === null);
  assert.ok(unplaced.length > 0 && unplaced.every((r) => r.precision === 'unknown'), 'unplaced items keep null coordinates (never fabricated)');
  assert.deepEqual(chaptersMentioned('after Credit Check in Chapter 3, or Chapter 2'), [3, 2]);
});

test('RSS/Atom feed parsing filters GTA VI posts and classifies them', () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>GTA 6: All Meditation Spot Locations</title><link>https://example.org/a</link><description><![CDATA[<p>Where to find all <b>10</b> spots</p>]]></description><pubDate>Sat, 21 Nov 2026 10:00:00 GMT</pubDate></item>
    <item><title>Some other game guide</title><link>https://example.org/b</link></item>
  </channel></rss>`;
  const leads = parseFeed(rss, { id: 'x', label: 'X', url: '', enabled: true, filter: 'gta 6' });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].suggestedGroup, 'collectibles');
  assert.equal(leads[0].summary, 'Where to find all 10 spots');
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>GTA 6 hidden weapon found</title><link href="https://example.org/c"/><updated>2026-11-21T00:00:00Z</updated></entry></feed>`;
  const a = parseFeed(atom, { id: 'y', label: 'Y', url: '', enabled: true, filter: 'gta 6' });
  assert.equal(a[0].url, 'https://example.org/c');
  assert.equal(classifyTitle('Best rare cars and exotic vehicle spawns'), 'vehicles');
});

test('Manual import: CSV and GeoJSON parsing with coordinate validation', () => {
  const rows = parseImportPayload('name,category,x,y,description\n"Stash, north",Hidden items,-3700,700,"a ""quoted"" note"\nNowhere,Hidden items,99999,0,\nNoCoords,Hidden items,,,');
  assert.equal(rows.length, 3);
  const c = buildImportCandidates(rows, { format: 'game', sourceLabel: 'test' });
  assert.equal(c[0].problem, null);
  assert.equal(c[0].record!.name, 'Stash, north');
  assert.equal(c[0].record!.description, 'a "quoted" note');
  assert.equal(c[1].problem, 'missing or out-of-bounds coordinates');
  assert.equal(c[2].record!.x, null);
  const geo = parseImportPayload({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-100, 200] }, properties: { name: 'G' } }] });
  assert.equal(geo[0].x, -100);
  assert.throws(() => parseImportPayload({ foo: 1 }), /Unrecognised import format/);
});

test('Duplicate detection: certain vs possible vs distinct', () => {
  const existing = [{ id: 'a', name: "Phil's Ammu-Nation", x: 0, y: 0, status: 'active', group: 'weapons' }] as LocationRecord[];
  assert.ok(nameSimilarity("Phil's Ammu-Nation", 'Phils Ammu-Nation') >= 0.5);
  assert.equal(findDuplicate({ name: "Phil's Ammu-Nation", x: 20, y: 10 }, existing)?.certain, true);
  assert.equal(findDuplicate({ name: "Phil's Ammu-Nation store", x: 200, y: 0 }, existing)?.certain, false);
  assert.equal(findDuplicate({ name: "Phil's Ammu-Nation", x: 5000, y: 0 }, existing), null);
  assert.equal(findDuplicate({ name: 'Totally different', x: 0, y: 0 }, existing), null);
});

test('Glitches: bundled list parses; every entry has steps or a summary, sources and a dated status', async () => {
  const { parseGlitchFile } = await import('../../server/ingest/glitches.ts');
  const { records } = parseGlitchFile(seed('glitches/glitches.json'));
  assert.ok(records.length >= 8, `got ${records.length}`);
  for (const r of records) {
    assert.equal(r.group, 'glitches');
    assert.ok(r.links.length > 0 && r.links.every((l) => l.url.startsWith('https://')), `${r.sourceKey} has https sources`);
    assert.match(r.availability ?? '', /Last checked \d{4}-\d{2}-\d{2}/, `${r.sourceKey} has a checked date`);
    assert.ok(r.tags.some((t) => t.startsWith('glitch-status:')));
  }
  const barn = records.find((r) => r.sourceKey === 'money-red-barn-save-reload')!;
  assert.equal(barn.category, 'Working glitches');
  assert.ok(barn.steps.length >= 5);
  // Pinned on the real GTADB landmark, not an invented coordinate.
  const lm = seed('gtadb/landmarks.json').L2453;
  assert.match(lm[0], /^Apollo Aggregates/);
  assert.ok(Math.abs(barn.x! - lm[1][0]) < 0.01 && Math.abs(barn.y! - lm[1][1]) < 0.01);
  // Entries without a named place stay off the map.
  assert.equal(records.find((r) => r.sourceKey === 'first-person-camera')!.x, null);
  assert.equal(records.find((r) => r.sourceKey === 'fake-money-generators')!.category, 'Fake glitches & scams');
});

test('Glitches: entries without sources or with unknown status are rejected', async () => {
  const { parseGlitchFile } = await import('../../server/ingest/glitches.ts');
  const ok = { id: 'a', kind: 'glitch', status: 'working', name: 'A', summary: 's', sources: [{ label: 'x', url: 'https://example.com/a' }] };
  const { records, notes } = parseGlitchFile({ schemaVersion: 1, updatedAt: '2026-01-01', entries: [ok, { ...ok, id: 'b', sources: [] }, { ...ok, id: 'c', status: 'maybe' }] });
  assert.deepEqual(records.map((r) => r.sourceKey), ['a']);
  assert.ok(notes.some((n) => n.includes('no sources')) && notes.some((n) => n.includes('unknown status')));
  assert.throws(() => parseGlitchFile({ schemaVersion: 2, entries: [] }));
});

test('Glitches: adapter falls back to the bundled list when the network fails', async () => {
  const { glitchesAdapter } = await import('../../server/ingest/glitches.ts');
  const os = await import('node:os');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'li-glitch-'));
  const res = await glitchesAdapter.run({
    dataDir, seedDir: path.join(ROOT_DIR, 'seed'), offline: false, previousRevision: null, config: {}, state: {}, firstRun: true,
    log: () => {}, http: async () => { throw new Error('offline'); },
  });
  assert.ok(res.records.length >= 8);
  assert.ok(res.notes[0].includes('bundled'));
});
