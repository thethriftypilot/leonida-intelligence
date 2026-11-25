import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../../server/config.ts';
import { lootNormalizedToGame, isValidGameCoord, distance } from '../../shared/coords.ts';
import { spoilerVisibility, redact } from '../../shared/spoilers.ts';
import { parseQuery, searchLocations, recommend, orderRoute, parseRewardDollars } from '../../shared/search.ts';
import { DEFAULT_SPOILERS, type LocationRecord } from '../../shared/types.ts';
import { rec } from './helpers.ts';

const seed = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'seed', f), 'utf8'));

function loc(id: string, o: Partial<LocationRecord> = {}): LocationRecord {
  return { ...rec(id), id, sourceId: 't', coordSystem: 'gtadb-vi', firstSeen: '', updatedAt: '', version: 1, status: 'active', mergedInto: null, ...o } as LocationRecord;
}

test('map calibration: Loot Map normalised frame matches GTADB venue coordinates exactly', () => {
  const landmarks = seed('gtadb/landmarks.json');
  const guides = [...seed('lootmap/guides.json'), ...seed('lootmap/collectible-guides.json')];
  let checked = 0;
  for (const g of guides) {
    const lid = (g.landmarkId ?? '').replace('gtadb-', '');
    const lm = landmarks[lid];
    if (!lm || !lm[1]?.length || g.precision !== 'venue') continue;
    const c = lootNormalizedToGame(g.x, g.y);
    assert.ok(distance(c, { x: lm[1][0], y: lm[1][1] }) < 2, `${g.id} misaligned by ${distance(c, { x: lm[1][0], y: lm[1][1] })}`);
    checked++;
  }
  assert.ok(checked >= 10, `expected ≥10 venue checks, got ${checked}`);
});

test('coordinate validation rejects missing, non-finite and out-of-world values', () => {
  assert.equal(isValidGameCoord(-3000, 1000), true);
  assert.equal(isValidGameCoord(null, 1000), false);
  assert.equal(isValidGameCoord(NaN, 0), false);
  assert.equal(isValidGameCoord(50000, 0), false);
  assert.equal(isValidGameCoord('1' as unknown as number, 2), false);
});

test('spoiler protection: story/late/gameplay/none matrix', () => {
  const s = { ...DEFAULT_SPOILERS, chapter: 0 };
  assert.equal(spoilerVisibility({ spoiler: 'none', chapterMin: null }, s), 'visible');
  assert.equal(spoilerVisibility({ spoiler: 'story', chapterMin: 0 }, s), 'visible');
  assert.equal(spoilerVisibility({ spoiler: 'story', chapterMin: 2 }, s), 'hidden');
  assert.equal(spoilerVisibility({ spoiler: 'story', chapterMin: null }, s), 'hidden');
  assert.equal(spoilerVisibility({ spoiler: 'late', chapterMin: 4 }, { ...s, hideStory: false }), 'hidden', 'late content hidden independently');
  assert.equal(spoilerVisibility({ spoiler: 'late', chapterMin: 4 }, { ...s, hideStory: false, hideLate: false }), 'visible');
  assert.equal(spoilerVisibility({ spoiler: 'gameplay', chapterMin: 3 }, s), 'redacted', 'weapon/bank location shown but details withheld');
  assert.equal(spoilerVisibility({ spoiler: 'gameplay', chapterMin: 3 }, { ...s, chapter: 3 }), 'visible');
  assert.equal(spoilerVisibility({ spoiler: 'gameplay', chapterMin: null }, s), 'visible');
  assert.equal(spoilerVisibility({ spoiler: 'gameplay', chapterMin: null }, { ...s, showUnknownChapter: false }), 'hidden');
  assert.equal(spoilerVisibility({ spoiler: 'story', chapterMin: 3 }, { ...s, chapter: 3 }), 'visible');
  assert.equal(spoilerVisibility({ spoiler: 'late', chapterMin: 5 }, { ...s, revealUntil: Date.now() + 10000 }), 'visible', 'temporary reveal');
  assert.equal(spoilerVisibility({ spoiler: 'late', chapterMin: 5 }, { ...s, revealUntil: Date.now() - 1 }), 'hidden', 'expired reveal');
  const r = redact(loc('a', { description: 'Vicki betrays you', steps: ['x'], chapterMin: 3 }));
  assert.ok(!r.description!.includes('Vicki'));
  assert.deepEqual(r.steps, []);
  assert.equal(r.redacted, true);
});

test('natural-language query parsing for the five reference questions', () => {
  const places = (t: string) => (t === 'vice city' ? { name: 'Vice City', x: -1000, y: 1000 } : null);
  const q1 = parseQuery('Where can I get a free gun early in the game?', places);
  assert.deepEqual(q1.groups, ['weapons']);
  assert.ok(q1.free && q1.early && q1.accessibleNow);
  const q2 = parseQuery('Show me hidden cash near Vice City', places);
  assert.ok(q2.groups.includes('money'));
  assert.equal(q2.near?.name, 'Vice City');
  const q3 = parseQuery('Find rare cars I can access right now', places);
  assert.ok(q3.groups.includes('vehicles') && q3.accessibleNow);
  const q4 = parseQuery("What secrets haven't I discovered?", places);
  assert.ok(q4.groups.includes('secrets') && q4.incomplete);
  const q5 = parseQuery('What should I do before moving to the next chapter?', places);
  assert.ok(q5.beforeNextChapter);
});

test('search ranks name matches, honours progress, chapter and proximity', () => {
  const locs = [
    loc('a', { name: 'Ammu-Nation', group: 'weapons', category: 'Gun stores', x: -1000, y: 1000 }),
    loc('b', { name: 'Pawn & Gun', group: 'weapons', category: 'Gun stores', x: 2000, y: 5000 }),
    loc('c', { name: 'Kenton dives', group: 'secrets', category: 'Underwater treasure', chapterMin: 3 }),
    loc('d', { name: 'Rusty Anchor card', group: 'collectibles', category: 'Trading cards', missable: true }),
  ];
  const s = { ...DEFAULT_SPOILERS, chapter: 1 };
  const near = searchLocations(locs, parseQuery('guns near vice city', (t) => (t === 'vice city' ? { name: 'Vice City', x: -1000, y: 1000 } : null)), {}, s);
  assert.equal(near.hits[0].loc.id, 'a');
  const secrets = searchLocations(locs, parseQuery('secrets I can access now'), {}, s);
  assert.equal(secrets.hits.length, 0, 'chapter 3 treasure not accessible in chapter 1');
  const done = { a: { locationId: 'a', visited: true, collected: false, completed: true, favorite: false, planned: false, notes: '', updatedAt: '', visitedAt: null, completedAt: '' } };
  const missing = searchLocations(locs, parseQuery("guns I haven't found"), done, s);
  assert.deepEqual(missing.hits.map((h) => h.loc.id), ['b']);
  const before = searchLocations(locs, parseQuery('missable things before the next chapter'), {}, s);
  assert.ok(before.hits.some((h) => h.loc.id === 'd'));
  const kw = searchLocations(locs, parseQuery('anchor'), {}, s);
  assert.equal(kw.hits[0].loc.id, 'd');
});

test('recommendations exclude locked and completed items and explain themselves', () => {
  const locs = [
    loc('vault', { group: 'money', description: 'Reported take of GTA$100,000–150,000.', chapterMin: 4 }),
    loc('loan', { group: 'money', description: 'Reported take of GTA$5,000–15,000.', chapterMin: 1 }),
    loc('bldg', { group: 'landmarks' }),
  ];
  const r = recommend(locs, {}, { ...DEFAULT_SPOILERS, chapter: 1 });
  assert.deepEqual(r.map((x) => x.loc.id), ['loan']);
  assert.ok(r[0].reasons.some((x) => x.includes('GTA$10,000')));
  assert.equal(parseRewardDollars('GTA$2,000–10,000'), 6000);
});

test('route ordering produces a shorter-or-equal straight-line path', () => {
  const pts = [{ id: '1', x: 0, y: 0 }, { id: '2', x: 1000, y: 0 }, { id: '3', x: 100, y: 0 }, { id: '4', x: 500, y: 0 }];
  const r = orderRoute({ x: -100, y: 0 }, pts);
  assert.deepEqual(r.order.map((p) => p.id), ['1', '3', '4', '2']);
  assert.equal(Math.round(r.total), 1100);
});

test('search: "money glitch" looks in Glitches & Fixes, narrowed by the other words', () => {
  const q = parseQuery('money glitch');
  assert.deepEqual(q.groups, ['glitches']);
  assert.deepEqual(q.terms, ['money']);
  const locs = [
    loc('g1', { group: 'glitches', name: 'Red barn money glitch', category: 'Working glitches' }),
    loc('g2', { group: 'glitches', name: 'First-person camera glitch', category: 'Working glitches' }),
    loc('m1', { group: 'money', name: 'Bank vault', category: 'Robberies' }),
  ];
  const { hits } = searchLocations(locs, q, {}, DEFAULT_SPOILERS);
  assert.deepEqual(hits.map((h) => h.loc.id), ['g1']);
});
