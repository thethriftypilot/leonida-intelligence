import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startApp, tempDir, rec, fakeAdapter, H } from './helpers.ts';
import { isPrivateAddress } from '../../server/security.ts';
import { openDatabases, USER_SCHEMA_VERSION } from '../../server/db.ts';

function adapterSet() {
  return [fakeAdapter('fake', {
    records: [
      rec('shop', { name: 'Test Ammu-Nation', group: 'weapons', category: 'Gun stores' }),
      rec('m-early', { name: 'Prologue Mission', group: 'story', category: 'Story missions', spoiler: 'story', chapterMin: 0 }),
      rec('m-late', { name: 'Secret Finale Mission', group: 'story', category: 'Story missions', spoiler: 'late', chapterMin: 5, description: 'Big twist' }),
      rec('vault', { name: 'Downtown Vault', group: 'money', category: 'Bank vaults', spoiler: 'gameplay', chapterMin: 4, description: 'Yasmani reveals plan' }),
      rec('unplaced', { name: 'Unplaced Meditation', x: null, y: null, precision: 'unknown' }),
    ],
  })];
}

test('progress persists across restart and is shared between clients (cross-device)', async () => {
  const dir = tempDir();
  let { app, ctx } = await startApp(dir, {}, { adapters: adapterSet() });
  await ctx.engine.run('test');
  let r = await app.inject({ method: 'PUT', url: '/api/progress/fake:shop', headers: H, payload: { visited: true, collected: true, notes: 'bought armor' }, remoteAddress: '192.168.1.20' });
  assert.equal(r.statusCode, 200);
  // a second device on the LAN sees it immediately
  r = await app.inject({ method: 'GET', url: '/api/progress', remoteAddress: '192.168.1.77' });
  assert.equal(r.json()['fake:shop'].notes, 'bought armor');
  const m = await app.inject({ method: 'POST', url: '/api/markers', headers: H, payload: { name: 'My stash', x: -3000, y: 900 } });
  assert.equal(m.statusCode, 200);
  await app.close();

  ({ app, ctx } = await startApp(dir, {}, { adapters: adapterSet() }));
  try {
    r = await app.inject({ method: 'GET', url: '/api/progress' });
    const p = r.json()['fake:shop'];
    assert.ok(p.visited && p.collected && p.completedAt);
    assert.equal((await app.inject({ method: 'GET', url: '/api/markers' })).json()[0].name, 'My stash');
    assert.equal(ctx.world.countActive(), 5, 'research data persisted too');
  } finally {
    await app.close();
  }
});

test('spoiler protection is enforced server-side for list, detail and search', async () => {
  const dir = tempDir();
  const { app, ctx } = await startApp(dir, {}, { adapters: adapterSet() });
  try {
    await ctx.engine.run('test');
    let list = (await app.inject({ method: 'GET', url: '/api/locations' })).json();
    const names = list.locations.map((l: { name: string }) => l.name);
    assert.ok(names.includes('Prologue Mission'));
    assert.ok(!names.includes('Secret Finale Mission'));
    assert.equal(list.hiddenCount, 1);
    const vault = list.locations.find((l: { id: string }) => l.id === 'fake:vault');
    assert.equal(vault.redacted, true);
    assert.ok(!JSON.stringify(list).includes('Big twist') && !JSON.stringify(list).includes('Yasmani'));
    assert.equal((await app.inject({ method: 'GET', url: '/api/locations/fake:m-late' })).statusCode, 404);
    const s = (await app.inject({ method: 'GET', url: '/api/search?q=finale' })).json();
    assert.equal(s.results.length, 0, 'search cannot leak hidden names');

    const reveal = (await app.inject({ method: 'GET', url: '/api/locations?reveal=1' })).json();
    assert.ok(reveal.locations.some((l: { name: string }) => l.name === 'Secret Finale Mission'));

    await app.inject({ method: 'PUT', url: '/api/settings', headers: H, payload: { spoilers: { chapter: 5, hideLate: false } } });
    list = (await app.inject({ method: 'GET', url: '/api/locations' })).json();
    assert.ok(list.locations.some((l: { name: string }) => l.name === 'Secret Finale Mission'));
    assert.equal(list.locations.find((l: { id: string }) => l.id === 'fake:vault').description, 'Yasmani reveals plan');
  } finally {
    await app.close();
  }
});

test('category filtering metadata, unplaced queue and search endpoint', async () => {
  const dir = tempDir();
  const { app, ctx } = await startApp(dir, {}, { adapters: adapterSet() });
  try {
    await ctx.engine.run('test');
    const meta = (await app.inject({ method: 'GET', url: '/api/meta' })).json();
    const weapons = meta.groups.find((g: { key: string }) => g.key === 'weapons');
    assert.equal(weapons.count, 1);
    assert.equal(weapons.categories[0].key, 'Gun stores');
    const un = (await app.inject({ method: 'GET', url: '/api/unplaced' })).json();
    assert.deepEqual(un.locations.map((l: { id: string }) => l.id), ['fake:unplaced']);
    const s = (await app.inject({ method: 'GET', url: '/api/search?q=' + encodeURIComponent('where can I get a gun') })).json();
    assert.equal(s.results[0].id, 'fake:shop');
    const near = (await app.inject({ method: 'GET', url: '/api/nearby?x=-3000&y=1000&radius=500' })).json();
    assert.ok(near.results.length >= 1);
    assert.equal((await app.inject({ method: 'GET', url: '/api/nearby?x=abc&y=1' })).statusCode, 400);
  } finally {
    await app.close();
  }
});

test('LAN-only guard, CSRF header and optional PIN', async () => {
  assert.equal(isPrivateAddress('192.168.0.5'), true);
  assert.equal(isPrivateAddress('::ffff:10.0.0.2'), true);
  assert.equal(isPrivateAddress('172.20.1.1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('172.32.0.1'), false);
  const dir = tempDir();
  let { app } = await startApp(dir, {}, { adapters: [] });
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/health', remoteAddress: '8.8.8.8' })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/api/health', remoteAddress: '192.168.1.9' })).statusCode, 200);
    const noHeader = await app.inject({ method: 'PUT', url: '/api/settings', headers: { 'content-type': 'application/json' }, payload: { updateIntervalHours: 6 } });
    assert.equal(noHeader.statusCode, 403);
  } finally {
    await app.close();
  }
  ({ app } = await startApp(dir, { accessPin: '4321' }, { adapters: [] }));
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/progress' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/login', headers: H, payload: { pin: '0000' } })).statusCode, 401);
    const ok = await app.inject({ method: 'POST', url: '/api/login', headers: H, payload: { pin: '4321' } });
    const cookie = String(ok.headers['set-cookie']).split(';')[0];
    assert.equal((await app.inject({ method: 'GET', url: '/api/progress', headers: { cookie } })).statusCode, 200);
  } finally {
    await app.close();
  }
});

test('backup export → wipe → restore round trip, server backups and research rollback', async () => {
  const dir = tempDir();
  const { app, ctx } = await startApp(dir, {}, { adapters: adapterSet() });
  try {
    await ctx.engine.run('test');
    await app.inject({ method: 'PUT', url: '/api/progress/fake:shop', headers: H, payload: { favorite: true, notes: 'keep me' } });
    await app.inject({ method: 'POST', url: '/api/checklists', headers: H, payload: { name: 'Before chapter 2' } });
    const exp = await app.inject({ method: 'GET', url: '/api/backup/export' });
    assert.match(String(exp.headers['content-disposition']), /attachment/);
    const backup = exp.json();
    assert.equal(backup.format, 'leonida-intelligence-user-backup');

    ctx.user.db.exec('DELETE FROM progress; DELETE FROM checklists;');
    assert.equal(Object.keys((await app.inject({ method: 'GET', url: '/api/progress' })).json()).length, 0);
    const res = await app.inject({ method: 'POST', url: '/api/backup/restore', headers: H, payload: { backup, mode: 'replace' } });
    assert.equal(res.statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/progress' })).json()['fake:shop'].notes, 'keep me');
    assert.equal((await app.inject({ method: 'GET', url: '/api/checklists' })).json()[0].name, 'Before chapter 2');
    const badRestore = await app.inject({ method: 'POST', url: '/api/backup/restore', headers: H, payload: { backup: { format: 'nope' } } });
    assert.equal(badRestore.statusCode, 400);

    const b = (await app.inject({ method: 'POST', url: '/api/backups', headers: H, payload: {} })).json();
    ctx.user.setProgress('fake:shop', { notes: 'changed later' });
    assert.equal((await app.inject({ method: 'POST', url: `/api/backups/${b.name}/restore`, headers: H, payload: {} })).statusCode, 200);
    assert.equal(ctx.user.getProgress('fake:shop')!.notes, 'keep me');
    assert.equal((await app.inject({ method: 'POST', url: '/api/backups/..%2F..%2Fx.sqlite/restore', headers: H, payload: {} })).statusCode, 400);

    // research rollback: a second update snapshots first; roll back undoes its additions
    (ctx.engine.deps.adapters[0] as ReturnType<typeof fakeAdapter>).behaviour.records!.push(rec('new-one'));
    await ctx.engine.run('test');
    assert.ok(ctx.world.get('fake:new-one'));
    const snaps = ctx.backups.worldSnapshots();
    assert.ok(snaps.length >= 1);
    const rb = await app.inject({ method: 'POST', url: `/api/snapshots/${snaps[0].name}/restore`, headers: H, payload: {} });
    assert.equal(rb.statusCode, 200);
    assert.equal(ctx.world.get('fake:new-one'), null);
    assert.equal(ctx.user.getProgress('fake:shop')!.favorite, true, 'rollback leaves progress alone');
  } finally {
    await app.close();
  }
});

test('manual import inserts valid rows, queues duplicates and bad coordinates; review approve creates a placed record', async () => {
  const dir = tempDir();
  const { app, ctx } = await startApp(dir, {}, { adapters: adapterSet() });
  try {
    await ctx.engine.run('test');
    const csv = 'name,category,x,y\nTest Ammu-Nation,Gun stores,-2990,1005\nBrand new stash,Hidden items,-2000,500\nLost thing,Hidden items,,';
    const r = (await app.inject({ method: 'POST', url: '/api/import', headers: H, payload: { data: csv, format: 'game', sourceLabel: 'unit' } })).json();
    assert.deepEqual([r.added, r.queued], [1, 2]);
    const q = (await app.inject({ method: 'GET', url: '/api/review' })).json();
    const dup = q.items.find((i: { kind: string }) => i.kind === 'possible-duplicate');
    assert.ok(dup);
    const ok = (await app.inject({ method: 'POST', url: `/api/review/${dup.id}`, headers: H, payload: { action: 'approve', x: -2500, y: 600 } })).json();
    assert.ok(ok.locationId);
    assert.equal(ctx.world.get(ok.locationId)!.verification, 'unconfirmed');
    const badPos = await app.inject({ method: 'POST', url: `/api/review/${q.items[0].id}`, headers: H, payload: { action: 'approve', x: 1e9, y: 0 } });
    assert.equal(badPos.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('settings validation and update interval', async () => {
  const dir = tempDir();
  const { app } = await startApp(dir, {}, { adapters: [] });
  try {
    assert.equal((await app.inject({ method: 'PUT', url: '/api/settings', headers: H, payload: { updateIntervalHours: 0 } })).statusCode, 400);
    const s = (await app.inject({ method: 'PUT', url: '/api/settings', headers: H, payload: { updateIntervalHours: 6, spoilers: { chapter: 2 } } })).json();
    assert.equal(s.updateIntervalHours, 6);
    assert.equal(s.spoilers.chapter, 2);
    assert.equal(s.spoilers.hideStory, true);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/settings', headers: H, payload: { myPosition: { x: 1e7, y: 0 } } })).statusCode, 400);
  } finally {
    await app.close();
  }
});

test('migrations: old user DB upgrades with a pre-migration backup; newer schema is refused', () => {
  const dir = tempDir();
  const file = path.join(dir, 'user.sqlite');
  // Simulate a v1 database created by an earlier release.
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE progress (location_id TEXT PRIMARY KEY, visited INTEGER NOT NULL DEFAULT 0, collected INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, planned INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, visited_at TEXT, completed_at TEXT);
    CREATE TABLE custom_markers (id TEXT PRIMARY KEY, name TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, icon TEXT NOT NULL DEFAULT 'pin', color TEXT NOT NULL DEFAULT '#ff5fa2', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE checklists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE checklist_items (id TEXT PRIMARY KEY, checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE, text TEXT NOT NULL, location_id TEXT, done INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE routes (id TEXT PRIMARY KEY, name TEXT NOT NULL, waypoints TEXT NOT NULL, start TEXT, created_at TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE verification_overrides (location_id TEXT PRIMARY KEY, verification TEXT NOT NULL, note TEXT, at TEXT NOT NULL);
    CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL, location_id TEXT, detail TEXT);
    INSERT INTO progress (location_id, visited, updated_at) VALUES ('gtadb:L1', 1, '2026-11-20');
    PRAGMA user_version = 1;`);
  old.close();
  let backedUp = false;
  const dbs = openDatabases(dir, (f) => { backedUp = true; fs.copyFileSync(f, path.join(dir, 'pre.sqlite')); });
  assert.ok(backedUp, 'backup hook ran before migrating');
  assert.equal((dbs.user.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, USER_SCHEMA_VERSION);
  assert.equal((dbs.user.prepare('SELECT visited FROM progress').get() as { visited: number }).visited, 1, 'data survived migration');
  dbs.user.exec('PRAGMA user_version = 99');
  dbs.close();
  assert.throws(() => openDatabases(dir), /newer than this application supports/);
});
