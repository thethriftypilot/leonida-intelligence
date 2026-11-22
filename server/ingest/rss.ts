// Community/news feed adapter. Reads public RSS/Atom feeds (published for syndication),
// keeps only GTA VI posts, classifies them by keyword and puts them in the review queue as
// research leads. Leads never become map markers automatically: they carry no coordinates.
// Retention is conservative — only title, link, date and a ≤280-char excerpt are stored.

import { XMLParser } from 'fast-xml-parser';
import type { AdapterContext, AdapterResult, Lead, SourceAdapter } from './types.ts';
import { GROUPS } from '../../shared/categories.ts';
import { normalizeText } from '../../shared/search.ts';

export interface FeedConfig {
  id: string;
  label: string;
  url: string;
  enabled: boolean;
  /** Case-insensitive regex a post title must match. */
  filter: string;
}

export const DEFAULT_FEEDS: FeedConfig[] = [
  { id: 'powerpyx', label: 'PowerPyx (guides)', url: 'https://www.powerpyx.com/feed/', enabled: true, filter: 'gta 6|gta vi|gta6' },
  { id: 'reddit-gta6', label: 'Reddit r/GTA6 (new posts)', url: 'https://www.reddit.com/r/GTA6/new/.rss', enabled: false, filter: 'location|where|found|hidden|secret|easter|collectible|cash|weapon|rare|spawn|map' },
];

const LOCATION_HINT = /\b(locations?|where to (find|get)|map|spawns?|all .* (spots|locations)|found|hidden|secret|easter egg|collectibles?|treasure)\b/i;

export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&quot;/g, '"').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
}

export function classifyTitle(title: string): string | null {
  const tokens = new Set(normalizeText(title).split(' '));
  let best: string | null = null;
  let bestScore = 0;
  for (const g of GROUPS) {
    const s = g.keywords.filter((k) => tokens.has(k)).length;
    if (s > bestScore) { best = g.key; bestScore = s; }
  }
  return best;
}

export function parseFeed(xml: string, feed: FeedConfig): Lead[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: true, htmlEntities: true });
  const doc = parser.parse(xml);
  const toArr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  const leads: Lead[] = [];
  const filter = new RegExp(feed.filter || '.', 'i');
  type Item = Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === 'string' ? v : v && typeof v === 'object' && '#text' in (v as Item) ? String((v as Item)['#text']) : '');

  const rssItems = toArr<Item>(doc?.rss?.channel?.item);
  const atomEntries = toArr<Item>(doc?.feed?.entry);
  for (const it of rssItems) {
    const title = stripHtml(text(it.title));
    const link = text(it.link) || text(it.guid);
    if (!title || !/^https?:\/\//.test(link) || !filter.test(title)) continue;
    const summary = stripHtml(text(it.description)).slice(0, 280) || null;
    leads.push({ key: link, title, url: link, summary, publishedAt: it.pubDate ? new Date(text(it.pubDate)).toISOString() : null, suggestedGroup: classifyTitle(title), feed: feed.label });
  }
  for (const e of atomEntries) {
    const title = stripHtml(text(e.title));
    const links = toArr<Item>(e.link as Item | Item[]);
    const link = String(links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate')?.['@_href'] ?? '');
    if (!title || !/^https?:\/\//.test(link) || !filter.test(title)) continue;
    const summary = stripHtml(text(e.summary) || text(e.content)).slice(0, 280) || null;
    const date = text(e.updated) || text(e.published);
    leads.push({ key: link, title, url: link, summary, publishedAt: date ? new Date(date).toISOString() : null, suggestedGroup: classifyTitle(title), feed: feed.label });
  }
  return leads;
}

export function isLocationLead(lead: Lead): boolean {
  return LOCATION_HINT.test(lead.title) || !!lead.suggestedGroup;
}

export const rssAdapter: SourceAdapter = {
  id: 'feeds',
  name: 'Community & guide feeds (research leads)',
  kind: 'leads',
  description: 'Polls public RSS/Atom feeds for new GTA VI guides and community finds. Matching posts become research leads in the review queue; you can turn a lead into a map marker after checking it.',
  homepage: 'https://www.powerpyx.com/',
  license: 'Links and short excerpts only; articles © their publishers',
  attribution: 'Feed items link back to their original publishers',
  defaultEnabled: true,
  defaultConfig: { feeds: DEFAULT_FEEDS },

  async run(ctx: AdapterContext): Promise<AdapterResult> {
    if (ctx.offline) return { revision: null, unchanged: true, snapshot: false, records: [], leads: [], notes: ['Offline mode: skipped'] };
    const feeds = (Array.isArray(ctx.config.feeds) ? ctx.config.feeds : DEFAULT_FEEDS) as FeedConfig[];
    const state = { ...(ctx.state as Record<string, { etag?: string; lastModified?: string }>) };
    const leads: Lead[] = [];
    const notes: string[] = [];
    const errors: string[] = [];
    let anyOk = false;
    for (const feed of feeds.filter((f) => f.enabled)) {
      try {
        const st = state[feed.id] ?? {};
        const headers: Record<string, string> = { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5' };
        if (st.etag) headers['If-None-Match'] = st.etag;
        if (st.lastModified) headers['If-Modified-Since'] = st.lastModified;
        const res = await ctx.http(feed.url, { headers, timeoutMs: 30000 });
        if (res.status === 304) { notes.push(`${feed.label}: not modified`); anyOk = true; continue; }
        if (res.status === 429) throw new Error('rate limited (HTTP 429) — will retry next cycle');
        if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        const found = parseFeed(xml, feed).filter(isLocationLead);
        leads.push(...found);
        state[feed.id] = { etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined };
        notes.push(`${feed.label}: ${found.length} relevant posts`);
        anyOk = true;
      } catch (e) {
        errors.push(`${feed.label}: ${(e as Error).message}`);
      }
    }
    if (!anyOk && errors.length) throw new Error(errors.join(' | '));
    return { revision: null, snapshot: false, records: [], leads, notes: [...notes, ...errors.map((e) => `error — ${e}`)], state };
  },
};
