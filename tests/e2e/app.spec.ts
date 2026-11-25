import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';

const H = { 'x-li-client': '1' };

async function waitForData(request: APIRequestContext) {
  await expect.poll(async () => (await (await request.get('/api/health')).json()).locations, { timeout: 60_000 }).toBeGreaterThan(3000);
}

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('map')).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible();
}

async function resetSettings(request: APIRequestContext) {
  await request.put('/api/settings', { headers: H, data: { spoilers: { chapter: 0, hideStory: true, hideLate: true, showUnknownChapter: true } } });
}

test.beforeAll(async ({ request }) => {
  await waitForData(request);
});
test.beforeEach(async ({ request, page }) => {
  await resetSettings(request);
  await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* */ } });
});

test('map renders real GTA VI tiles and zooms', async ({ page }) => {
  await openApp(page);
  await expect.poll(() => page.locator('img.leaflet-tile-loaded').count()).toBeGreaterThan(3);
  const src = await page.locator('img.leaflet-tile-loaded').first().getAttribute('src');
  expect(src).toMatch(/\/tiles\/day\/\d+\/\d+,\d+,\d+\.jpg/);
  const z0 = await page.evaluate(() => (window as unknown as { __liMap: { getZoom(): number } }).__liMap.getZoom());
  await page.locator('.leaflet-control-zoom-in').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __liMap: { getZoom(): number } }).__liMap.getZoom())).toBeGreaterThan(z0);
  await expect(page.locator('.li-coords')).toBeVisible();
});

test('search suggestion selects a marker and shows sourced details', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('search-input').fill('Jack of Hearts');
  await page.locator('.li-suggest button', { hasText: 'Jack of Hearts' }).first().click();
  await expect(page.getByTestId('detail-title')).toHaveText('Jack of Hearts');
  const panel = page.getByTestId('detail-panel');
  await expect(panel.locator('a[href*="map.gtadb.org"]').first()).toBeVisible();
  await expect(panel).toContainText('Community corroborated');
  await expect(panel).toContainText('Vice City');
  await expect(page.locator('.li-pin.sel')).toBeVisible();
});

test('category filtering changes what the map shows', async ({ page }) => {
  await openApp(page);
  const counter = page.locator('.li-left-head span').first();
  const before = Number((await counter.innerText()).split(' ')[0].replace(/,/g, ''));
  await page.getByTestId('group-services').locator('input').uncheck();
  await expect.poll(async () => Number((await counter.innerText()).split(' ')[0].replace(/,/g, ''))).toBeLessThan(before);
  await page.getByTestId('group-services').locator('input').check();
  await expect.poll(async () => Number((await counter.innerText()).split(' ')[0].replace(/,/g, ''))).toBe(before);
});

test('natural-language search answers from local data', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('search-input').fill('Where can I get a free gun early in the game?');
  await page.getByTestId('search-input').press('Enter');
  await expect(page.getByTestId('search-interpretation')).toContainText('Weapons & Equipment');
  await expect(page.getByTestId('search-results').locator('li').first()).toBeVisible();
  await expect(page.getByTestId('search-results')).toContainText(/Ammu-Nation|Gun stores/);
});

test('spoiler protection hides future story content until chapter or reveal', async ({ page, request }) => {
  const hidden = await (await request.get('/api/locations')).json();
  expect(hidden.hiddenCount).toBeGreaterThan(50);
  expect(hidden.locations.some((l: { name: string }) => l.name === 'Unwanted Attention')).toBe(false);
  await openApp(page);
  await page.getByTestId('search-input').fill('Unwanted Attention');
  await page.waitForTimeout(400);
  await expect(page.locator('.li-suggest', { hasText: 'Unwanted Attention' })).toHaveCount(0);
  // reveal temporarily (with confirmation)
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('spoiler-button').click();
  await page.getByTestId('reveal-button').click();
  await expect(page.locator('.li-reveal-banner')).toBeVisible();
  await page.getByTestId('search-input').fill('Unwanted Attention');
  await expect(page.locator('.li-suggest')).toContainText('Unwanted Attention');
  await page.locator('.li-reveal-banner button').click();
  await expect(page.locator('.li-reveal-banner')).toHaveCount(0);
  // advancing the chapter makes Chapter 1 content visible permanently
  await page.getByTestId('chapter-select').selectOption('1');
  await page.getByTestId('search-input').fill('Unwanted Attention');
  await expect(page.locator('.li-suggest')).toContainText('Unwanted Attention');
});

test('progress persists after reload and in a second browser', async ({ page, browser }) => {
  await openApp(page);
  await page.getByTestId('search-input').fill('Jack of Hearts');
  await page.locator('.li-suggest button', { hasText: 'Jack of Hearts' }).first().click();
  await page.getByTestId('flag-visited').click();
  await page.getByTestId('flag-favorite').click();
  await page.getByTestId('notes').fill('Bought a drink here');
  await expect(page.getByTestId('detail-panel')).toContainText('Saved to server', { timeout: 5000 });
  await expect(page.getByTestId('flag-visited')).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await page.getByTestId('search-input').fill('Jack of Hearts');
  await page.locator('.li-suggest button', { hasText: 'Jack of Hearts' }).first().click();
  await expect(page.getByTestId('flag-visited')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('notes')).toHaveValue('Bought a drink here');

  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await ctx2.newPage();
  await openApp(p2);
  await p2.getByTestId('search-input').fill('Jack of Hearts');
  await p2.locator('.li-suggest button', { hasText: 'Jack of Hearts' }).first().click();
  await expect(p2.getByTestId('flag-favorite')).toHaveAttribute('aria-pressed', 'true');
  await expect(p2.getByTestId('notes')).toHaveValue('Bought a drink here');
  await ctx2.close();
});

test('backup export and restore through the UI', async ({ page, request }, info) => {
  const loc = (await (await request.get('/api/locations')).json()).locations.find((l: { name: string }) => l.name === 'Jack of Hearts');
  await request.put(`/api/progress/${encodeURIComponent(loc.id)}`, { headers: H, data: { notes: 'state A', completed: true } });
  await openApp(page);
  await page.getByRole('button', { name: 'Tools' }).click();
  await page.getByTestId('tab-data').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-backup').click()]);
  const file = info.outputPath('backup.json');
  await download.saveAs(file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(data.format).toBe('leonida-intelligence-user-backup');

  await request.put(`/api/progress/${encodeURIComponent(loc.id)}`, { headers: H, data: { notes: 'state B', completed: false } });
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('restore-file').setInputFiles(file);
  await expect(page.locator('.li-toast').filter({ hasText: 'Restored' })).toBeVisible();
  const p = (await (await request.get('/api/progress')).json())[loc.id];
  expect(p.notes).toBe('state A');
  expect(p.completed).toBe(true);
});

test('manual update run reports results in the UI', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Tools' }).click();
  await page.getByTestId('tab-updates').click();
  await page.getByTestId('run-update').click();
  await expect(page.locator('.li-toast').filter({ hasText: /Update (complete|partly failed|failed)/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('update-runs').locator('li').first()).toContainText('manual');
});

test('smart tools: recommendations, missing, community and surprise', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Tools' }).click();
  await page.getByTestId('tab-first').click();
  await expect(page.getByTestId('recommendations').locator('li').first()).toBeVisible();
  await page.getByTestId('tab-missing').click();
  await expect(page.getByTestId('missing')).toContainText('left');
  await page.getByTestId('tab-community').click();
  await expect(page.getByTestId('community')).toBeVisible();
  await page.getByRole('button', { name: /Surprise me/ }).click();
  await expect(page.getByTestId('detail-panel')).toBeVisible();
});

test('glitches tab lists sourced glitches with status and step-by-step instructions', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('glitches-button').click();
  const tool = page.getByTestId('glitches-tool');
  await expect(tool).toContainText('Working glitches');
  // Story bugs stay hidden at the Prologue.
  await expect(tool).not.toContainText('Missing Persons');
  await tool.getByText('Red barn money glitch (save and reload)').click();
  await expect(page.getByTestId('detail-title')).toHaveText('Red barn money glitch (save and reload)');
  await expect(page.getByTestId('glitch-status')).toHaveText('Working');
  await expect(page.getByTestId('detail-panel')).toContainText('How to do it');
  await expect(page.getByTestId('detail-panel').locator('.li-steps li')).toHaveCount(7);
});

test('mobile layout is usable', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await openApp(page);
  await page.locator('.li-menu').click();
  await expect(page.locator('.li-left.open')).toBeVisible();
  await page.locator('.li-left-close').click();
  await page.getByTestId('search-input').fill('Jack of Hearts');
  await page.locator('.li-suggest button', { hasText: 'Jack of Hearts' }).first().click();
  await expect(page.getByTestId('detail-title')).toBeVisible();
  await ctx.close();
});

test('play mode guides to the nearest unfinished place and records finds', async ({ page, request }) => {
  await openApp(page);
  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('play-mode')).toBeVisible();
  const select = page.getByTestId('play-start-select');
  const region = await select.locator('option').nth(2).getAttribute('value');
  await select.selectOption(region!);
  await page.getByTestId('play-start').click();
  const target = page.getByTestId('play-target');
  await expect(target).toBeVisible();
  const first = (await target.locator('h3').textContent())!.trim();
  await expect(target).toContainText(/\d+(\.\d+)? k?m/);
  await expect(page.locator('.li-highlight-banner')).toContainText('play mode targets');

  await page.getByTestId('play-got-it').click();
  await expect(page.getByTestId('play-found')).toContainText('1 found');
  await expect(target.locator('h3')).not.toHaveText(first);
  const prog = await (await request.get('/api/progress')).json() as Record<string, { collected: boolean; completed: boolean }>;
  expect(Object.values(prog).some((p) => p.collected || p.completed)).toBe(true);

  const second = (await target.locator('h3').textContent())!.trim();
  await page.getByTestId('play-skip').click();
  await expect(target.locator('h3')).not.toHaveText(second);

  await page.getByTestId('play-end').click();
  await expect(page.getByTestId('play-summary')).toContainText('1 found');
  await expect(page.locator('.li-highlight-banner')).toHaveCount(0);
});

test('live sync: a change on one device appears on another without reloading', async ({ page, request }) => {
  await openApp(page);
  await expect(page.getByTestId('live-indicator')).toHaveClass(/on/);
  const { locations } = await (await request.get('/api/locations')).json() as { locations: { id: string; name: string; group: string; category: string }[] };
  const l = locations.find((x) => x.group === 'collectibles' && x.category !== 'Unnamed buildings')!;
  await request.put(`/api/progress/${encodeURIComponent(l.id)}`, { headers: H, data: { favorite: true } });
  await expect(page.locator('.li-toasts')).toContainText(`Synced from another device: ${l.name}`);
  await request.put(`/api/progress/${encodeURIComponent(l.id)}`, { headers: H, data: { favorite: false } });
});

test('dashboard shows achievements and draws a shareable progress card', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Dashboard' }).click();
  const ach = page.getByTestId('achievements');
  await expect(ach).toContainText('Welcome to Leonida');
  await expect(ach).toContainText(/\d+ of \d+ unlocked/);
  await page.getByTestId('share-button').click();
  const canvas = page.getByTestId('share-canvas');
  await expect(canvas).toBeVisible();
  expect(await canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBe(1200);
  const painted = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL('image/png').length);
  expect(painted).toBeGreaterThan(20_000);
});
