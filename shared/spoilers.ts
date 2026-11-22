import type { LocationRecord, SpoilerSettings } from './types.ts';

export type Visibility = 'visible' | 'redacted' | 'hidden';

/**
 * Decide how a record may be shown under the current spoiler settings.
 *  - hidden:   not sent to the client at all (no name, no search hit, no suggestion)
 *  - redacted: shown on the map with its name, but description/steps withheld
 *  - visible:  everything shown
 */
export function spoilerVisibility(
  loc: Pick<LocationRecord, 'spoiler' | 'chapterMin'>,
  s: SpoilerSettings,
  now: number = Date.now(),
): Visibility {
  if (s.revealUntil && now < s.revealUntil) return 'visible';
  const reached = loc.chapterMin !== null && loc.chapterMin <= s.chapter;

  if (loc.spoiler === 'late') {
    if (s.hideLate && !reached) return 'hidden';
    if (s.hideStory && !reached) return 'hidden';
    return 'visible';
  }
  if (loc.spoiler === 'story') {
    if (!s.hideStory) return 'visible';
    return reached ? 'visible' : 'hidden';
  }
  if (loc.spoiler === 'gameplay') {
    if (loc.chapterMin === null) return s.showUnknownChapter ? 'visible' : 'hidden';
    if (reached) return 'visible';
    // Reveals where something is, but text may reference later story beats.
    return s.hideStory ? 'redacted' : 'visible';
  }
  return 'visible';
}

export function redact<T extends LocationRecord>(loc: T): T {
  const when = loc.chapterMin !== null ? `Chapter ${loc.chapterMin}` : 'a later chapter';
  return {
    ...loc,
    description: `Details hidden by spoiler protection until ${when}.`,
    steps: [],
    rewards: null,
    characters: null,
    evidence: null,
    availability: `Available from ${when}`,
    redacted: true,
  };
}

export function chapterLabel(ch: number | null, maxChapter = 5): string {
  if (ch === null) return 'Unknown chapter';
  if (ch === 0) return 'Prologue';
  if (ch >= 99) return 'Story complete';
  if (ch > maxChapter) return `After Chapter ${maxChapter}`;
  return `Chapter ${ch}`;
}

export function isRevealActive(s: SpoilerSettings, now = Date.now()): boolean {
  return !!s.revealUntil && now < s.revealUntil;
}
