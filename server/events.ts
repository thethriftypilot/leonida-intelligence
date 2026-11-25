// Live sync: a Server-Sent Events hub. Whenever one device changes something, every other
// open browser on the network hears about it within a moment and refreshes just that part.
// Events carry only a channel name and an id, never personal content.

import type { ServerResponse } from 'node:http';

export type Channel = 'progress' | 'markers' | 'checklists' | 'routes' | 'settings' | 'world';

export interface LiveEvent { channel: Channel; id?: string; device?: string }

/** Which channel a successful write request changes, or null if it changes nothing shared. */
export function channelFor(method: string, url: string): Channel | null {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  const p = url.split('?')[0];
  if (p.startsWith('/api/progress/')) return 'progress';
  if (p.startsWith('/api/markers')) return 'markers';
  if (p.startsWith('/api/checklist')) return 'checklists';
  if (p.startsWith('/api/routes')) return 'routes';
  if (p === '/api/settings') return 'settings';
  if (p.startsWith('/api/backup') || p.startsWith('/api/backups/')) return 'world';
  if (p.startsWith('/api/locations/') || p.startsWith('/api/review/') || p === '/api/import' || p.startsWith('/api/snapshots/') || p.startsWith('/api/sources/')) return 'world';
  return null;
}

export class EventHub {
  private clients = new Set<ServerResponse>();
  private timer: NodeJS.Timeout | null = null;

  get size(): number { return this.clients.size; }

  add(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    res.write('retry: 3000\n\n');
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
    // A comment every 25 s keeps proxies and phones from dropping an idle connection.
    if (!this.timer) {
      this.timer = setInterval(() => { for (const c of this.clients) c.write(': ping\n\n'); }, 25_000);
      this.timer.unref();
    }
  }

  publish(e: LiveEvent): void {
    const data = `data: ${JSON.stringify(e)}\n\n`;
    for (const c of this.clients) c.write(data);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const c of this.clients) c.end();
    this.clients.clear();
  }
}
