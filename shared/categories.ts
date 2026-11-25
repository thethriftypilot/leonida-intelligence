// Category system. Groups are fixed top-level buckets; categories inside them are
// open-ended: adapters may emit any new category label and it appears automatically.

export interface GroupDef {
  key: string;
  label: string;
  color: string;
  icon: string; // lucide icon name, resolved in the web client
  keywords: string[];
}

export const GROUPS: GroupDef[] = [
  { key: 'weapons', label: 'Weapons & Equipment', color: '#ff4d4d', icon: 'crosshair',
    keywords: ['gun', 'guns', 'weapon', 'weapons', 'ammo', 'ammunition', 'armor', 'armour', 'ammu', 'ammu-nation', 'equipment', 'gear', 'bag', 'duffel', 'rifle', 'pistol', 'shotgun'] },
  { key: 'money', label: 'Money & Robberies', color: '#3ddc84', icon: 'banknote',
    keywords: ['money', 'cash', 'rob', 'robbery', 'robberies', 'heist', 'heists', 'bank', 'banks', 'vault', 'vaults', 'loan', 'loans', 'loot', 'safe', 'safes', 'fence', 'payday', 'dollars', 'rich', 'earn'] },
  { key: 'vehicles', label: 'Vehicles & Transport', color: '#4da3ff', icon: 'car',
    keywords: ['car', 'cars', 'vehicle', 'vehicles', 'bike', 'bikes', 'motorcycle', 'boat', 'boats', 'plane', 'planes', 'aircraft', 'helicopter', 'garage', 'garages', 'modshop', 'mod', 'customize', 'customise', 'repair', 'spray', 'airport', 'marina', 'train', 'metro', 'bus', 'transport', 'exotic', 'rare'] },
  { key: 'secrets', label: 'Secrets & Easter Eggs', color: '#b06bff', icon: 'eye',
    keywords: ['secret', 'secrets', 'easter', 'egg', 'eggs', 'hidden', 'mystery', 'mysteries', 'treasure', 'treasures', 'underwater', 'interior', 'interiors', 'enterable', 'reference'] },
  { key: 'collectibles', label: 'Collectibles & Challenges', color: '#ffc93c', icon: 'gem',
    keywords: ['collectible', 'collectibles', 'collect', 'card', 'cards', 'magazine', 'magazines', 'book', 'books', 'meditation', 'meditations', 'watch', 'watches', 'scan', 'scans', 'sculpture', 'trophy', 'trophies', 'challenge', 'challenges', 'race', 'races', 'trial', 'trials', 'stunt', 'stunts', 'completion', '100%'] },
  { key: 'activities', label: 'Activities & Leisure', color: '#2ee6d6', icon: 'dumbbell',
    keywords: ['activity', 'activities', 'pool', 'golf', 'gym', 'fitness', 'arcade', 'tennis', 'bowling', 'club', 'nightclub', 'bar', 'bars', 'cinema', 'leisure', 'fun', 'minigame', 'minigames'] },
  { key: 'services', label: 'Businesses & Services', color: '#ff9f43', icon: 'store',
    keywords: ['shop', 'shops', 'store', 'stores', 'clothes', 'clothing', 'barber', 'hair', 'tattoo', 'tattoos', 'safehouse', 'safehouses', 'property', 'properties', 'hospital', 'police', 'gas', 'food', 'restaurant', 'electronics', 'earbuds', 'headphones', 'supermarket', 'pharmacy', 'business', 'service', 'services'] },
  { key: 'story', label: 'Story & Missions', color: '#ff5fa2', icon: 'clapperboard',
    keywords: ['mission', 'missions', 'story', 'strangers', 'stranger', 'side', 'job', 'jobs', 'quest', 'contact'] },
  { key: 'glitches', label: 'Glitches & Fixes', color: '#ff7a1a', icon: 'bug',
    keywords: ['glitch', 'glitches', 'exploit', 'exploits', 'bug', 'bugs', 'patch', 'patched', 'patches', 'fix', 'fixes', 'fixed', 'softlock', 'crash', 'crashes', 'dupe', 'duplicate', 'duplication', 'workaround', 'update', 'updates', 'cheese'] },
  { key: 'landmarks', label: 'Landmarks & Places', color: '#9aa4b8', icon: 'landmark',
    keywords: ['landmark', 'landmarks', 'place', 'places', 'building', 'buildings', 'hotel', 'hotels', 'park', 'beach', 'poi', 'point', 'interest'] },
];

export const GROUP_BY_KEY: Record<string, GroupDef> = Object.fromEntries(GROUPS.map((g) => [g.key, g]));

export function groupLabel(key: string): string {
  return GROUP_BY_KEY[key]?.label ?? key;
}

export function categoryKey(group: string, category: string): string {
  return `${group}/${category}`;
}

/** Categories that are noisy for players; hidden by default but available as a filter. */
export const DEFAULT_HIDDEN_CATEGORIES = ['landmarks/Unnamed buildings'];
