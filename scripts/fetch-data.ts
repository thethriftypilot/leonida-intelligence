// Downloads the GTADB map tiles and landmark data as a sparse git checkout into
// data/sources/gtadb — the method the GTADB maintainers ask for ("simply git pull").
// Usage: node scripts/fetch-data.ts [--hires] [--no-community]
//   --hires         also fetch zoom level 6 of the game map (~23k extra tiles, larger download)
//   --no-community  skip the alternative YANIS v18 community road map layer
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT_DIR } from '../server/config.ts';

const args = new Set(process.argv.slice(2));
const dataDir = path.resolve(ROOT_DIR, process.env.LI_DATA_DIR ?? 'data');
const dir = path.join(dataDir, 'sources', 'gtadb');
const REPO = 'https://github.com/rolux/gtadb.org';

function git(a: string[], cwd?: string) {
  execFileSync('git', a, { cwd, stdio: 'inherit', windowsHide: true });
}

try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('git is required to download the map (install from https://git-scm.com/ or `winget install Git.Git`).');
  process.exit(1);
}

const patterns = ['/map/data/6/*', '/LICENSE*', '/readme.md', '/maps/tiles/6/day/[0-5]/*'];
if (args.has('--hires')) patterns.push('/maps/tiles/6/day/6/*');
if (!args.has('--no-community')) patterns.push('/maps/tiles/6/yanis,18/[0-5]/*');

fs.mkdirSync(path.dirname(dir), { recursive: true });
if (!fs.existsSync(path.join(dir, '.git'))) {
  console.log(`Cloning GTADB (sparse, no history) into ${dir} …`);
  git(['clone', '--filter=blob:none', '--sparse', '--depth', '1', REPO, dir]);
} else {
  console.log('Updating existing GTADB checkout …');
  git(['fetch', '--depth', '1', '--filter=blob:none', 'origin', 'main'], dir);
  git(['reset', '--hard', 'FETCH_HEAD'], dir);
}
console.log('Selecting map tiles and landmark data (this can take a few minutes the first time) …');
// --no-cone with explicit patterns; set via stdin-free args (patterns are literal, not shell-expanded)
git(['sparse-checkout', 'set', '--no-cone', ...patterns], dir);

const count = (p: string) => (fs.existsSync(p) ? fs.readdirSync(p, { recursive: true }).filter((f) => String(f).endsWith('.jpg')).length : 0);
console.log(`Game map tiles: ${count(path.join(dir, 'maps', 'tiles', '6', 'day'))}`);
console.log(`Community map tiles: ${count(path.join(dir, 'maps', 'tiles', '6', 'yanis,18'))}`);
console.log(`Landmarks file: ${fs.existsSync(path.join(dir, 'map', 'data', '6', 'landmarks.json')) ? 'present' : 'MISSING'}`);
console.log('Done. Map data is licensed CC BY 4.0 by gtadb.org and contributors (see ATTRIBUTION.md).');
