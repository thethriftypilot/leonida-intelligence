import { test } from 'node:test';
import assert from 'node:assert/strict';
import { huntQueue, bearing, doneFlagFor, formatDuration } from '../../shared/play.ts';
import { computeAchievements, newlyUnlocked } from '../../shared/achievements.ts';
import { channelFor, EventHub } from '../../server/events.ts';
import type { LocationRecord, Progress } from '../../shared/types.ts';
import { rec } from './helpers.ts';
import { PassThrough } from 'node:stream';

function loc(id: string, o: Partial<LocationRecord> = {}): LocationRecord {
  return { ...rec(id), id, sourceId: 't', coordSystem: 'gtadb-vi', firstSeen: '', updatedAt: '', version: 1, status: 'active', mergedInto: null, ...o } as LocationRecord;
}
const done = (id: string): Progress => ({ locationId: id, visited: true, collected: true, completed: false, favorite: false, planned: false, notes: '', updatedAt: '', visitedAt: null, completedAt: null });

test('play mode: nearest unfinished, unlocked, positioned places come first', () => {
  const locs = [
    loc('far', { x: 5000, y: 0 }),
    loc('near', { x: 100, y: 0 }),
    loc('done', { x: 10, y: 0 }),
    loc('later-chapter', { x: 20, y: 0, chapterMin: 3 }),
    loc('no-position', { x: null, y: null, precision: 'unknown' }),
    loc('disputed', { x: 30, y: 0, verification: 'disputed' }),
    loc('area', { x: 40, y: 0, precision: 'area' }),
    loc('wrong-group', { x: 50, y: 0, group: 'landmarks' }),
    loc('redacted', { x: 60, y: 0, redacted: true }),
  ];
  const progress = { done: done('done') };
  const q = huntQueue(locs, progress, { groups: ['collectibles'], from: { x: 0, y: 0 }, chapter: 1 });
  assert.deepEqual(q.map((h) => h.loc.id), ['near', 'far']);
  assert.equal(Math.round(q[0].distance), 100);

  const withArea = huntQueue(locs, progress, { groups: ['collectibles'], from: { x: 0, y: 0 }, chapter: 3, includeApprox: true });
  assert.deepEqual(withArea.map((h) => h.loc.id), ['later-chapter', 'area', 'near', 'far']);

  const skipped = huntQueue(locs, progress, { groups: ['collectibles'], from: { x: 0, y: 0 }, chapter: 1, skipped: new Set(['near']) });
  assert.deepEqual(skipped.map((h) => h.loc.id), ['far']);
});

test('play mode: compass bearings use x east / y north', () => {
  const o = { x: 0, y: 0 };
  assert.equal(bearing(o, { x: 0, y: 100 }).label, 'north');
  assert.equal(bearing(o, { x: 100, y: 0 }).label, 'east');
  assert.equal(bearing(o, { x: 0, y: -100 }).label, 'south');
  assert.equal(bearing(o, { x: -100, y: 100 }).label, 'north-west');
  assert.equal(doneFlagFor(loc('a', { group: 'collectibles' })), 'collected');
  assert.equal(doneFlagFor(loc('b', { group: 'story' })), 'completed');
  assert.equal(formatDuration(65_000), '1:05');
  assert.equal(formatDuration(3_725_000), '1:02:05');
});

test('achievements unlock from stats and report progress towards the next', () => {
  const base = { completed: 0, visited: 0, trackable: 200, completionPct: 0, favorites: 0, planned: 0, verified: 0, groups: [{ key: 'collectibles', label: 'Collectibles', total: 4, done: 4 }, { key: 'landmarks', label: 'Landmarks', total: 9, done: 0 }] };
  const none = computeAchievements(base);
  assert.equal(none.find((a) => a.id === 'first-find')?.unlocked, false);
  assert.ok(none.find((a) => a.id === 'group-collectibles')?.unlocked, 'a fully finished group unlocks');
  assert.equal(none.find((a) => a.id === 'group-landmarks'), undefined, 'landmarks have no achievement');

  const some = computeAchievements({ ...base, completed: 12, visited: 30, completionPct: 26 });
  const ten = some.find((a) => a.id === 'done-10')!;
  assert.ok(ten.unlocked);
  const fifty = some.find((a) => a.id === 'done-50')!;
  assert.deepEqual([fifty.current, fifty.target, fifty.unlocked], [12, 50, false]);
  assert.ok(some.find((a) => a.id === 'overall-25')?.unlocked);

  const fresh = newlyUnlocked(some, new Set(none.filter((a) => a.unlocked).map((a) => a.id)));
  assert.deepEqual(fresh.map((a) => a.id).sort(), ['done-10', 'first-find', 'overall-25', 'visit-25'].sort());
});

test('live sync: write requests map to channels; reads and unknown routes do not', () => {
  assert.equal(channelFor('PUT', '/api/progress/gtadb-L1'), 'progress');
  assert.equal(channelFor('POST', '/api/markers'), 'markers');
  assert.equal(channelFor('DELETE', '/api/checklist-items/5'), 'checklists');
  assert.equal(channelFor('PUT', '/api/settings'), 'settings');
  assert.equal(channelFor('POST', '/api/review/3'), 'world');
  assert.equal(channelFor('GET', '/api/progress'), null);
  assert.equal(channelFor('POST', '/api/login'), null);
  assert.equal(channelFor('POST', '/api/updates/run'), null);
});

test('live sync: the hub streams events to every connected client', () => {
  const hub = new EventHub();
  const out: string[] = [];
  const res = Object.assign(new PassThrough(), { writeHead() { return res; } });
  res.on('data', (d: Buffer) => out.push(d.toString()));
  hub.add(res as never);
  hub.publish({ channel: 'progress', id: 'x', device: 'abc' });
  assert.equal(hub.size, 1);
  const body = out.join('');
  assert.match(body, /retry: 3000/);
  assert.match(body, /data: \{"channel":"progress","id":"x","device":"abc"\}/);
  hub.close();
  assert.equal(hub.size, 0);
});
