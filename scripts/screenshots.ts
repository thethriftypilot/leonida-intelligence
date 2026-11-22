// Regenerates the README screenshots in docs/screenshots/.
// Starts an isolated server (fresh data dir, offline seed data, real map tiles), adds a little
// demo progress so the progress UI isn't empty, and captures each view with Playwright.
// Story progress stays at the Prologue so the images contain no story spoilers.
// Usage: node scripts/screenshots.ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { ROOT_DIR } from '../server/config.ts';

const PORT = 5198;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT_DIR, 'docs', 'screenshots');
const H = { 'x-li-client': '1', 'content-type': 'application/json' };

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/e2e-server.ts'], {
  cwd: ROOT_DIR, env: { ...process.env, LI_PORT: String(PORT) }, stdio: 'ignore',
});
process.on('exit', () => server.kill());

async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return (await r.json()) as T;
}

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const h = await api<{ locations: number }>('GET', '/api/health');
      if (h.locations > 3000) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('server did not become ready');
}

async function settle(page: Page, ms = 1500) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(ms);
}

async function shot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82 });
  console.log(`  ✓ ${name}.jpg`);
}

async function openAt(page: Page, view: { x: number; y: number; zoom: number }, extra: Record<string, unknown> = {}) {
  await page.addInitScript(([v, e]) => {
    localStorage.clear();
    localStorage.setItem('li.view', JSON.stringify(v));
    for (const [k, val] of Object.entries(e as Record<string, unknown>)) localStorage.setItem(k, JSON.stringify(val));
  }, [view, extra] as const);
  await page.goto(BASE);
  await page.locator('.leaflet-marker-icon').first().waitFor();
}

async function selectByName(page: Page, name: string) {
  await page.getByTestId('search-input').fill(name);
  await page.locator('.li-suggest button', { hasText: name }).first().click();
  await page.getByTestId('detail-title').waitFor();
}

await waitReady();
fs.mkdirSync(OUT, { recursive: true });

// --- demo progress (UI state only; locations themselves are real sourced records)
const { locations } = await api<{ locations: { id: string; name: string; group: string; category: string; x: number | null }[] }>('GET', '/api/locations');
const byName = (n: string) => locations.find((l) => l.name === n);
const pick = (group: string, n: number) => locations.filter((l) => l.group === group && l.x !== null && l.category !== 'Unnamed buildings').slice(0, n);
for (const l of [...pick('services', 6), ...pick('vehicles', 4), ...pick('activities', 5)]) await api('PUT', `/api/progress/${encodeURIComponent(l.id)}`, { visited: true, completed: true });
for (const l of pick('weapons', 3)) await api('PUT', `/api/progress/${encodeURIComponent(l.id)}`, { visited: true, favorite: true });
for (const l of pick('collectibles', 3)) await api('PUT', `/api/progress/${encodeURIComponent(l.id)}`, { planned: true });
const joh = byName('Jack of Hearts');
if (joh) await api('PUT', `/api/progress/${encodeURIComponent(joh.id)}`, { visited: true, favorite: true, notes: 'Club upstairs — check the magazine collectible later.' });
await api('PUT', '/api/settings', { myPosition: { x: -1150, y: 600 } });
await api('POST', '/api/markers', { name: 'Parked boat', x: -620, y: 1650, color: '#2ee6d6' });

const browser = await chromium.launch();
const desktop = { viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 };

// 1. Overview
{
  const page = await browser.newPage(desktop);
  await openAt(page, { x: -3700, y: 900, zoom: 1.75 });
  await shot(page, 'overview');
  await page.close();
}
// 2. Location details with in-game photo
{
  const page = await browser.newPage(desktop);
  await openAt(page, { x: -686, y: 1195, zoom: 5 });
  await selectByName(page, 'Jack of Hearts');
  await page.waitForTimeout(2500);
  await shot(page, 'location-details');
  await page.close();
}
// 3. Natural-language search, results highlighted on the map
{
  const page = await browser.newPage(desktop);
  await openAt(page, { x: -2500, y: 800, zoom: 2 });
  await page.getByTestId('search-input').fill('Where can I get a gun?');
  await page.getByTestId('search-input').press('Enter');
  await page.getByTestId('search-results').locator('li').first().waitFor();
  await page.getByRole('button', { name: 'Show only these on the map' }).click();
  await shot(page, 'smart-search');
  await page.close();
}
// 4. What should I get first?
{
  const page = await browser.newPage(desktop);
  await openAt(page, { x: -3700, y: 900, zoom: 1.75 });
  await page.getByRole('button', { name: 'Tools' }).click();
  await page.getByTestId('tab-first').click();
  await page.getByTestId('recommendations').locator('li').first().waitFor();
  await shot(page, 'recommendations');
  await page.close();
}
// 5. Discovery planner with a straight-line route
{
  const route = ['lootmap:guide-loan-quick-buck-hamlet', 'lootmap:guide-loan-payday-loans-store-southside', 'lootmap:guide-loan-payday-loans-store-little-cuba', 'lootmap:guide-loan-payday-loans-store-rockridge', 'lootmap:guide-loan-quick-buck-la-perle'];
  const page = await browser.newPage(desktop);
  await openAt(page, { x: -1500, y: -250, zoom: 2.1 }, { 'li.route': { start: { x: -1150, y: 600 }, ids: route } });
  await page.getByRole('button', { name: 'Tools' }).click();
  await page.getByTestId('tab-planner').click();
  await page.getByRole('button', { name: 'Optimise order' }).click();
  await shot(page, 'route-planner');
  await page.close();
}
// 6. Spoiler protection
{
  const page = await browser.newPage(desktop);
  await openAt(page, { x: -3700, y: 900, zoom: 1.75 });
  await page.getByTestId('spoiler-button').click();
  await shot(page, 'spoiler-protection');
  await page.close();
}
// 7. Dashboard
{
  const page = await browser.newPage(desktop);
  await openAt(page, { x: -3700, y: 900, zoom: 1.75 });
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.getByTestId('dashboard').waitFor();
  await shot(page, 'dashboard');
  await page.close();
}
// 8. Research updates & source health
{
  const page = await browser.newPage(desktop);
  await openAt(page, { x: -3700, y: 900, zoom: 1.75 });
  await page.getByRole('button', { name: 'Tools' }).click();
  await page.getByTestId('tab-updates').click();
  await page.getByTestId('update-runs').locator('li').first().waitFor();
  await shot(page, 'research-updates');
  await page.close();
}
// 9. Night style + progress bar
{
  const page = await browser.newPage(desktop);
  await openAt(page, { x: -1000, y: 900, zoom: 3 }, { 'li.prefs': { layer: 'night' }, 'li.bottom': { open: true } });
  await shot(page, 'night-style');
  await page.close();
}
// 10. Phone
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await openAt(page, { x: -686, y: 1195, zoom: 4.5 });
  await selectByName(page, 'Jack of Hearts');
  await shot(page, 'mobile');
  await page.close();
}

await browser.close();
server.kill();
console.log(`Screenshots written to ${OUT}`);
process.exit(0);
