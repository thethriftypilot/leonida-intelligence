// Achievements: milestones worked out from your own progress. Nothing is stored; they are
// recomputed from the stats, so they can never drift from what you have actually marked.

export interface AchievementInput {
  completed: number;
  visited: number;
  trackable: number;
  completionPct: number;
  favorites: number;
  planned: number;
  verified: number;
  groups: { key: string; label: string; total: number; done: number }[];
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  tier: 'bronze' | 'silver' | 'gold' | 'legend';
  current: number;
  target: number;
  unlocked: boolean;
}

const GROUP_TITLES: Record<string, [string, string]> = {
  collectibles: ['Completionist', '💎'],
  money: ['Made Man', '💰'],
  weapons: ['Armed to the Teeth', '🎯'],
  secrets: ['Secret Keeper', '👁️'],
  activities: ['Living the Life', '🌴'],
  vehicles: ['Gearhead', '🏎️'],
  story: ['Leading Role', '🎬'],
  services: ['Regular Customer', '🛍️'],
};

export function computeAchievements(s: AchievementInput): Achievement[] {
  const list: Achievement[] = [];
  const add = (id: string, title: string, description: string, icon: string, tier: Achievement['tier'], current: number, target: number) => {
    const t = Math.max(1, target);
    list.push({ id, title, description, icon, tier, current: Math.min(current, t), target: t, unlocked: current >= t });
  };

  add('first-find', 'Welcome to Leonida', 'Collect or complete your first discovery.', '🌅', 'bronze', s.completed, 1);
  add('done-10', 'Getting Started', 'Finish 10 discoveries.', '🗺️', 'bronze', s.completed, 10);
  add('done-50', 'Local Legend', 'Finish 50 discoveries.', '⭐', 'silver', s.completed, 50);
  add('done-150', 'Kingpin of Leonida', 'Finish 150 discoveries.', '👑', 'gold', s.completed, 150);
  add('visit-25', 'Road Tripper', 'Visit 25 places.', '🚗', 'bronze', s.visited, 25);
  add('visit-100', 'Tourist Trap', 'Visit 100 places.', '📸', 'silver', s.visited, 100);
  add('visit-300', 'Sunshine State Explorer', 'Visit 300 places.', '🧭', 'gold', s.visited, 300);
  add('plan-5', 'Planner', 'Plan 5 places for a later session.', '📋', 'bronze', s.planned, 5);
  add('fav-10', 'Taste Maker', 'Favourite 10 places.', '❤️', 'bronze', s.favorites, 10);
  add('verify-5', 'Field Agent', 'Confirm 5 locations in-game with "I found it".', '🕵️', 'silver', s.verified, 5);

  if (s.trackable > 0) {
    for (const [pct, title, icon, tier] of [[25, 'Quarter Way There', '🥉', 'bronze'], [50, 'Halfway to Glory', '🥈', 'silver'], [75, 'The Home Stretch', '🥇', 'gold'], [100, '100% Leonida', '🏆', 'legend']] as const) {
      add(`overall-${pct}`, title, `Reach ${pct}% overall completion.`, icon, tier, Math.floor(s.completionPct), pct);
    }
  }

  for (const g of s.groups) {
    const meta = GROUP_TITLES[g.key];
    if (!meta || g.total < 3) continue;
    add(`group-${g.key}`, meta[0], `Finish every ${g.label.toLowerCase()} entry you can currently see (${g.total}).`, meta[1], 'gold', g.done, g.total);
  }
  return list;
}

/** Ids that are unlocked now but were not in `seen`. */
export function newlyUnlocked(list: Achievement[], seen: Set<string>): Achievement[] {
  return list.filter((a) => a.unlocked && !seen.has(a.id));
}
