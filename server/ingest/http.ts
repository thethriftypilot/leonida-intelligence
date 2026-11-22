import type { Http, HttpResponse } from './types.ts';

export const USER_AGENT = 'LeonidaIntelligence/1.0 (personal, non-commercial GTA VI companion; low-frequency polling)';

/** Per-host politeness: at most one request per host every `minGapMs`. */
const lastHit = new Map<string, number>();

export function createHttp(opts: { minGapMs?: number; retries?: number } = {}): Http {
  const minGap = opts.minGapMs ?? 1500;
  const retries = opts.retries ?? 2;
  return async (url, init = {}) => {
    const host = new URL(url).host;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const wait = (lastHit.get(host) ?? 0) + minGap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastHit.set(host, Date.now());
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 30000);
      try {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) }, signal: ctl.signal, redirect: 'follow' });
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          const ra = Number(res.headers.get('retry-after'));
          const backoff = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60000) : 2000 * 2 ** attempt;
          attempt++;
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        return res as unknown as HttpResponse;
      } catch (e) {
        if (attempt < retries) {
          attempt++;
          await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
          continue;
        }
        const msg = (e as Error).name === 'AbortError' ? `timeout fetching ${url}` : `network error fetching ${url}: ${(e as Error).message}`;
        throw new Error(msg);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export function expectOk(res: HttpResponse, url: string): void {
  if (res.status === 429) throw new Error(`rate limited by ${new URL(url).host} (HTTP 429)`);
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} from ${url}`);
}
