import { renderToStaticMarkup } from 'react-dom/server';
import {
  Banknote, Bug, Car, Clapperboard, Crosshair, Dumbbell, Eye, Gem, Landmark, MapPin, Store, Star, Check, type LucideIcon,
} from 'lucide-react';

export const GROUP_ICONS: Record<string, LucideIcon> = {
  weapons: Crosshair,
  money: Banknote,
  vehicles: Car,
  secrets: Eye,
  collectibles: Gem,
  activities: Dumbbell,
  services: Store,
  story: Clapperboard,
  glitches: Bug,
  landmarks: Landmark,
  personal: MapPin,
};

const svgCache = new Map<string, string>();
export function iconSvg(group: string, size = 14): string {
  const key = `${group}:${size}`;
  let s = svgCache.get(key);
  if (!s) {
    const Icon = GROUP_ICONS[group] ?? MapPin;
    s = renderToStaticMarkup(<Icon size={size} strokeWidth={2.4} color="currentColor" />);
    svgCache.set(key, s);
  }
  return s;
}

export const STAR_SVG = renderToStaticMarkup(<Star size={9} strokeWidth={3} fill="currentColor" />);
export const CHECK_SVG = renderToStaticMarkup(<Check size={10} strokeWidth={4} />);

export function GroupIcon({ group, size = 16 }: { group: string; size?: number }) {
  const Icon = GROUP_ICONS[group] ?? MapPin;
  return <Icon size={size} strokeWidth={2.2} />;
}
