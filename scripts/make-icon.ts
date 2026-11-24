// Renders web/public/icon.svg into installer/leonida.ico (16-256 px) for the Windows installer and
// tray app. Uses Playwright's Chromium, so run `npx playwright install chromium` first if needed.
// The .ico is committed, so this only needs re-running when the logo changes.
//   node scripts/make-icon.ts
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { ROOT_DIR } from '../server/config.ts';

const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const svg = fs.readFileSync(path.join(ROOT_DIR, 'web', 'public', 'icon.svg'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
const rendered: { size: number; rgba?: number[]; png?: string }[] = await page.evaluate(
  async ({ svg, sizes }) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(svg);
    await img.decode();
    return sizes.map((size) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);
      if (size >= 256) return { size, png: c.toDataURL('image/png').split(',')[1] };
      return { size, rgba: Array.from(ctx.getImageData(0, 0, size, size).data) };
    });
  },
  { svg, sizes: SIZES },
);
await browser.close();

// Small sizes as 32-bit DIBs (best compatibility), 256 px as PNG (standard since Windows Vista).
const images = rendered.map(({ size, rgba, png }) => {
  if (png) return { size, data: Buffer.from(png, 'base64') };
  const maskRow = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4; // DIB rows are stored bottom-up
      const dst = (y * size + x) * 4;
      pixels[dst] = rgba![src + 2];
      pixels[dst + 1] = rgba![src + 1];
      pixels[dst + 2] = rgba![src];
      pixels[dst + 3] = rgba![src + 3];
    }
  }
  return { size, data: Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]) };
});

const dir = Buffer.alloc(6 + 16 * images.length);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(images.length, 4);
let offset = dir.length;
images.forEach(({ size, data }, i) => {
  const e = 6 + i * 16;
  dir.writeUInt8(size >= 256 ? 0 : size, e);
  dir.writeUInt8(size >= 256 ? 0 : size, e + 1);
  dir.writeUInt16LE(1, e + 4);
  dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(data.length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += data.length;
});
const out = path.join(ROOT_DIR, 'installer', 'leonida.ico');
fs.writeFileSync(out, Buffer.concat([dir, ...images.map((i) => i.data)]));
console.log(`Wrote ${out} (${SIZES.join(', ')} px)`);
