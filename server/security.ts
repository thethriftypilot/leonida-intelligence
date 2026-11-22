// LAN-only access control:
//  - requests from non-private IP addresses are refused (unless LI_ALLOW_PUBLIC_IPS=true)
//  - optional access PIN (LI_ACCESS_PIN) with an HMAC-signed session cookie
//  - state-changing API calls must carry the X-LI-Client header (blocks cross-site form posts)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

export function isPrivateAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  let a = addr.trim();
  if (a.startsWith('::ffff:')) a = a.slice(7);
  if (net.isIPv4(a)) {
    const [p, q] = a.split('.').map(Number);
    return p === 10 || p === 127 || (p === 192 && q === 168) || (p === 172 && q >= 16 && q <= 31) || (p === 169 && q === 254) || (p === 100 && q >= 64 && q <= 127);
  }
  if (net.isIPv6(a)) {
    const l = a.toLowerCase();
    return l === '::1' || l.startsWith('fe80:') || l.startsWith('fc') || l.startsWith('fd');
  }
  return false;
}

export function loadSecret(dataDir: string): Buffer {
  const file = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

export function sessionToken(secret: Buffer, pin: string): string {
  return crypto.createHmac('sha256', secret).update(`li-session:${pin}`).digest('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
