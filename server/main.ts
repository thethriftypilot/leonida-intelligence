import os from 'node:os';
import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';

const cfg = loadConfig();
const { app, ctx } = await buildApp(cfg);

try {
  await app.listen({ host: cfg.host, port: cfg.port });
} catch (e) {
  console.error(`Could not start on ${cfg.host}:${cfg.port}: ${(e as Error).message}`);
  console.error('Another program may be using this port. Set LI_PORT in .env to a different port.');
  process.exit(1);
}

const urls = [`http://localhost:${cfg.port}`];
if (cfg.host === '0.0.0.0' || cfg.host === '::') {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${cfg.port}`);
  }
}
console.log('');
console.log('  Leonida Intelligence is running (unofficial GTA VI companion)');
for (const u of urls) console.log(`    → ${u}`);
console.log(`  Data directory: ${cfg.dataDir}`);
console.log(`  Locations: ${ctx.world.countActive()} · research updates every ${ctx.scheduler.intervalHours()} h · access PIN ${cfg.accessPin ? 'enabled' : 'off'}`);
console.log('  Press Ctrl+C to stop.');
console.log('');

let stopping = false;
async function shutdown(sig: string) {
  if (stopping) return;
  stopping = true;
  console.log(`\n${sig} received — shutting down cleanly…`);
  const t = setTimeout(() => process.exit(0), 10000);
  t.unref();
  try { await app.close(); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e));
