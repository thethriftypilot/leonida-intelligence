// Draws a 1200×630 "my Leonida progress" image in the browser. Nothing is uploaded anywhere:
// the image is made on this device and saved or copied by the player.

import type { Stats } from './api.ts';
import type { Achievement } from '../../shared/achievements.ts';

const DISPLAY = "'Bahnschrift', 'DIN Condensed', 'Arial Narrow', 'Roboto Condensed', system-ui, sans-serif";
const BODY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export function drawProgressCard(canvas: HTMLCanvasElement, stats: Stats, achievements: Achievement[]): void {
  const W = 1200, H = 630;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  if (!c) return;

  // Vice City dusk backdrop.
  const bg = c.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1a0830'); bg.addColorStop(0.55, '#0c0716'); bg.addColorStop(1, '#2a0c24');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  const sun = c.createRadialGradient(960, 120, 10, 960, 120, 420);
  sun.addColorStop(0, '#ff9f4366'); sun.addColorStop(0.5, '#ff5fa222'); sun.addColorStop(1, '#0000');
  c.fillStyle = sun; c.fillRect(0, 0, W, H);
  c.strokeStyle = '#ff5fa214'; c.lineWidth = 1;
  for (let y = 380; y < H; y += 18) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }

  // Brand.
  c.fillStyle = '#ff5fa2'; c.font = `700 44px ${DISPLAY}`; c.fillText('LEONIDA', 64, 92);
  const w = c.measureText('LEONIDA ').width;
  c.fillStyle = '#2ee6d6'; c.font = `400 44px ${DISPLAY}`; c.fillText('INTELLIGENCE', 64 + w, 92);
  c.fillStyle = '#a99cbf'; c.font = `500 22px ${BODY}`; c.fillText('My GTA VI progress', 64, 128);

  // Completion ring.
  const cx = 230, cy = 350, r = 140, pct = Math.max(0, Math.min(100, stats.completionPct));
  c.lineWidth = 26; c.lineCap = 'round';
  c.strokeStyle = '#2e2244'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
  const ring = c.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ring.addColorStop(0, '#ff5fa2'); ring.addColorStop(1, '#ff9f43');
  c.strokeStyle = ring; c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * pct) / 100); c.stroke();
  c.textAlign = 'center';
  c.fillStyle = '#ece6f6'; c.font = `700 84px ${DISPLAY}`; c.fillText(`${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`, cx, cy + 22);
  c.fillStyle = '#a99cbf'; c.font = `500 20px ${BODY}`; c.fillText('complete', cx, cy + 56);
  c.textAlign = 'left';

  // Headline numbers.
  const unlocked = achievements.filter((a) => a.unlocked);
  const nums: [string, string][] = [
    [stats.completed.toLocaleString(), `of ${stats.trackable.toLocaleString()} found`],
    [stats.visited.toLocaleString(), 'places visited'],
    [`${unlocked.length}/${achievements.length}`, 'achievements'],
  ];
  nums.forEach(([v, k], i) => {
    const x = 450 + i * 240;
    c.fillStyle = '#ece6f6'; c.font = `700 54px ${DISPLAY}`; c.fillText(v, x, 230);
    c.fillStyle = '#a99cbf'; c.font = `500 19px ${BODY}`; c.fillText(k, x, 260);
  });

  // Category bars.
  const groups = stats.groups
    .filter((g) => g.key !== 'landmarks' && g.key !== 'glitches' && g.total >= 3)
    .sort((a, b) => b.done / b.total - a.done / a.total || b.total - a.total)
    .slice(0, 5);
  groups.forEach((g, i) => {
    const y = 312 + i * 50;
    const frac = g.total ? g.done / g.total : 0;
    c.fillStyle = '#ece6f6'; c.font = `600 19px ${BODY}`; c.fillText(g.label, 450, y);
    c.fillStyle = '#a99cbf'; c.textAlign = 'right'; c.fillText(`${g.done}/${g.total}`, 1136, y); c.textAlign = 'left';
    c.fillStyle = '#2e2244'; roundRect(c, 450, y + 10, 686, 12, 6); c.fill();
    c.fillStyle = g.color; roundRect(c, 450, y + 10, Math.max(12, 686 * frac), 12, 6); c.fill();
  });

  // Latest badges.
  const shown = unlocked.slice(-6);
  if (shown.length) {
    c.font = `34px ${BODY}`;
    shown.forEach((a, i) => c.fillText(a.icon, 64 + i * 50, 586));
  }

  c.fillStyle = '#a99cbf'; c.font = `500 17px ${BODY}`; c.textAlign = 'right';
  c.fillText('Unofficial fan tool · github.com/thethriftypilot/leonida-intelligence', 1136, 590);
  c.textAlign = 'left';
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
