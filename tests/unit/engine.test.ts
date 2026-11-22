import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, tempDir, rec, fakeAdapter } from './helpers.ts';

test('ingestion: add → update → remove, with history, report and preserved progress', async () => {
  const dir = tempDir();
  const a = fakeAdapter('fake', { records: [rec('1'), rec('2'), rec('3')], revision: 'r1' });
  const { app, ctx } = await startApp(dir, {}, { adapters: [a] });
  try {
    let run = await ctx.engine.run('test');
    assert.equal(run.status, 'ok');
    assert.equal(run.sources[0].added, 3);
    ctx.user.setProgress('fake:2', { completed: true, notes: 'got it' });

    a.behaviour.records = [rec('1', { description: 'better evidence' }), rec('2'), rec('4')];
    a.behaviour.revision = 'r2';
    run = await ctx.engine.run('test');
    const r = run.sources[0];
    assert.deepEqual([r.added, r.updated, r.unchanged, r.removed], [1, 1, 1, 1]);
    assert.match(run.summary, /\+1 new, 1 changed, 1 removed/);
    assert.equal(ctx.world.get('fake:1')!.version, 2);
    assert.equal(ctx.world.get('fake:3')!.status, 'removed');
    assert.equal(ctx.world.get('fake:3')!.verification, 'outdated');
    assert.ok(ctx.world.historyFor('fake:1').some((h) => h.change === 'updated'));
    assert.equal(ctx.user.getProgress('fake:2')!.completed, true, 'progress untouched by research update');
    assert.equal(ctx.user.getProgress('fake:2')!.notes, 'got it');

    a.behaviour.records = [rec('1', { description: 'better evidence' }), rec('2'), rec('3'), rec('4')];
    run = await ctx.engine.run('test');
    assert.equal(ctx.world.get('fake:3')!.status, 'active', 'restored when it reappears');
  } finally {
    await app.close();
  }
});

test('ingestion: a failing source does not break the others and is reported accurately', async () => {
  const dir = tempDir();
  const good = fakeAdapter('good', { records: [rec('g1')] });
  const bad = fakeAdapter('bad', { fail: 'HTTP 503 from https://example.org/feed' });
  const { app, ctx } = await startApp(dir, {}, { adapters: [bad, good] });
  try {
    const run = await ctx.engine.run('test');
    assert.equal(run.status, 'partial');
    const b = run.sources.find((s) => s.sourceId === 'bad')!;
    assert.equal(b.status, 'error');
    assert.match(b.error!, /HTTP 503/);
    assert.equal(run.sources.find((s) => s.sourceId === 'good')!.added, 1);
    assert.match(run.summary, /FAILED \(HTTP 503/);
    const src = ctx.world.sources().find((s) => s.id === 'bad')!;
    assert.equal(src.lastStatus, 'error');
    assert.equal(src.lastSuccessAt, null);
    bad.behaviour.fail = undefined;
    bad.behaviour.records = [rec('b1')];
    const run2 = await ctx.engine.run('test');
    assert.equal(run2.status, 'ok');
  } finally {
    await app.close();
  }
});

test('ingestion: invalid coordinates are queued, duplicate keys rejected, mass removal blocked', async () => {
  const dir = tempDir();
  const many = Array.from({ length: 40 }, (_, i) => rec(`m${i}`, { x: -3000 + i * 10 }));
  const a = fakeAdapter('fake', { records: [...many, rec('bad', { x: 999999, y: 5 }), rec('m1')] });
  const { app, ctx } = await startApp(dir, {}, { adapters: [a] });
  try {
    const run = await ctx.engine.run('test');
    const r = run.sources[0];
    assert.equal(r.added, 41);
    assert.equal(r.rejected, 1, 'duplicate key in the same source output');
    assert.equal(r.queued, 1);
    assert.equal(ctx.world.get('fake:bad')!.x, null, 'never stored at a fabricated/invalid position');
    assert.equal(ctx.world.reviewList('pending', 'invalid-coordinates').length, 1);

    a.behaviour.records = many.slice(0, 5);
    const run2 = await ctx.engine.run('test');
    assert.equal(run2.sources[0].removed, 0);
    assert.ok(run2.sources[0].notes.some((n) => n.includes('removal skipped')));
    assert.equal(ctx.world.countActive('fake'), 41);
  } finally {
    await app.close();
  }
});

test('ingestion: concurrent update requests share one run; merge migrates progress', async () => {
  const dir = tempDir();
  const a = fakeAdapter('fake', { records: [rec('1'), rec('2')] });
  const { app, ctx } = await startApp(dir, {}, { adapters: [a] });
  try {
    const [r1, r2] = await Promise.all([ctx.engine.run('test'), ctx.engine.run('test')]);
    assert.equal(r1.id, r2.id);
    ctx.user.setProgress('fake:2', { visited: true, notes: 'dup notes' });
    ctx.user.setProgress('fake:1', { favorite: true });
    ctx.world.merge('fake:2', 'fake:1', null);
    ctx.user.migrateProgress('fake:2', 'fake:1');
    const p = ctx.user.getProgress('fake:1')!;
    assert.ok(p.visited && p.favorite);
    assert.match(p.notes, /dup notes/);
  } finally {
    await app.close();
  }
});

test('ingestion: real offline seed import produces mapped, attributed data', async () => {
  const dir = tempDir();
  const { app, ctx } = await startApp(dir);
  try {
    const run = await ctx.engine.run('test');
    assert.equal(run.status, 'ok');
    assert.ok(ctx.world.countActive('gtadb') > 3500);
    assert.ok(ctx.world.countActive('lootmap') > 200);
    const all = ctx.world.all();
    assert.ok(all.every((l) => l.sourceUrl || l.sourceLabel), 'every record carries attribution');
    const again = await ctx.engine.run('test');
    assert.equal(again.sources.find((s) => s.sourceId === 'gtadb')!.status, 'unchanged');
  } finally {
    await app.close();
  }
});
