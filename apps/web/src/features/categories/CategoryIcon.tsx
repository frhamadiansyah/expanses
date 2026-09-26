import { categoryVisual, TRANSFER_VISUAL, UNKNOWN_VISUAL } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import {
  ArrowLeftRight, Baby, BadgePercent, Banknote, Bed, Blocks, Book, BookOpen, Brain, Briefcase, Brush, Building, Building2, Bus, BusFront, Cake,
  Car, CarTaxiFront, ChartLine, ChefHat, CircleEllipsis, CircleHelp, CircleParking, CirclePlus, Clapperboard, ClipboardPlus, Coffee, Drama,
  Droplets, Dumbbell, Eye, FileCheck, FileText, Film, Flame, Flower, Flower2, Fuel, Gamepad2, Gavel, Gem, Gift, GraduationCap, HandCoins,
  HandHeart, HandHelping, Hammer, HeartHandshake, HeartPulse, House, IdCard, KeyRound, Landmark, Laptop, type LucideIcon, Mail, Map as MapIcon, MapPin,
  MessageCircleHeart, Package, PaintRoller, Palette, PartyPopper, Percent, Pill, PillBottle, Plane, Presentation, Receipt, Repeat, Sandwich,
  School, Scissors, Shield, ShieldAlert, ShieldCheck, ShieldPlus, Shirt, ShoppingBag, ShoppingBasket, Siren, Smartphone, Sofa, Sparkles,
  SprayCan, Stethoscope, Tent, Ticket, Trash2, TrendingUp, Trophy, Users, UsersRound, Utensils, UtensilsCrossed, Wallet, Wifi, Wrench, Zap,
} from 'lucide-react';

/**
 * Every icon name the category data can use, mapped to a drawing bundled with the app.
 *
 * Bundled rather than loaded from an icon service: the app makes no network requests beyond exchange
 * rates. A test holds this map and the category data in step, so a name with no drawing cannot ship.
 */
export const ICONS: Readonly<Record<string, LucideIcon>> = {
  'arrow-left-right': ArrowLeftRight, baby: Baby, 'badge-percent': BadgePercent, banknote: Banknote, bed: Bed, blocks: Blocks, book: Book,
  'book-open': BookOpen, brain: Brain, briefcase: Briefcase, brush: Brush, building: Building, 'building-2': Building2, bus: Bus, 'bus-front': BusFront,
  cake: Cake, car: Car, 'car-taxi-front': CarTaxiFront, 'chart-line': ChartLine, 'chef-hat': ChefHat, 'circle-ellipsis': CircleEllipsis,
  'circle-help': CircleHelp, 'circle-parking': CircleParking, 'circle-plus': CirclePlus, clapperboard: Clapperboard, 'clipboard-plus': ClipboardPlus,
  coffee: Coffee, drama: Drama, droplets: Droplets, dumbbell: Dumbbell, eye: Eye, 'file-check': FileCheck, 'file-text': FileText, film: Film,
  flame: Flame, flower: Flower, 'flower-2': Flower2, fuel: Fuel, 'gamepad-2': Gamepad2, gavel: Gavel, gem: Gem, gift: Gift,
  'graduation-cap': GraduationCap, 'hand-coins': HandCoins, 'hand-heart': HandHeart, 'hand-helping': HandHelping, hammer: Hammer,
  'heart-handshake': HeartHandshake, 'heart-pulse': HeartPulse, house: House, 'id-card': IdCard, 'key-round': KeyRound, landmark: Landmark,
  laptop: Laptop, mail: Mail, map: MapIcon, 'map-pin': MapPin, 'message-circle-heart': MessageCircleHeart, package: Package, 'paint-roller': PaintRoller,
  palette: Palette, 'party-popper': PartyPopper, percent: Percent, pill: Pill, 'pill-bottle': PillBottle, plane: Plane, presentation: Presentation,
  receipt: Receipt, repeat: Repeat, sandwich: Sandwich, school: School, scissors: Scissors, shield: Shield, 'shield-alert': ShieldAlert,
  'shield-check': ShieldCheck, 'shield-plus': ShieldPlus, shirt: Shirt, 'shopping-bag': ShoppingBag, 'shopping-basket': ShoppingBasket,
  siren: Siren, smartphone: Smartphone, sofa: Sofa, sparkles: Sparkles, 'spray-can': SprayCan, stethoscope: Stethoscope, tent: Tent,
  ticket: Ticket, 'trash-2': Trash2, 'trending-up': TrendingUp, trophy: Trophy, users: Users, 'users-round': UsersRound, utensils: Utensils,
  'utensils-crossed': UtensilsCrossed, wallet: Wallet, wifi: Wifi, wrench: Wrench, zap: Zap,
};

/** A category's own key and its top-level parent's, walking up from any category in the tree. */
export function categoryKeys(categoryId: string | null, accounts: readonly AccountRow[]): { key: string | null; rootKey: string | null; rootName: string | null } {
  if (!categoryId) return { key: null, rootKey: null, rootName: null };
  const byId = new Map(accounts.map((account) => [account.id, account]));
  let current = byId.get(categoryId);
  const key = current?.systemKey ?? null;
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parentId);
  }
  return { key, rootKey: current?.systemKey ?? null, rootName: current && current.id !== categoryId ? current.name : null };
}

/** A category's glyph and tint, for a row that draws its own circle — the kit's rows tint an icon themselves. */
export function categoryMark(categoryId: string | null, accounts: readonly AccountRow[]): { Glyph: LucideIcon; colour: string; name: string | null } {
  const { key, rootKey } = categoryKeys(categoryId, accounts);
  const category = categoryId ? accounts.find((a) => a.id === categoryId) : undefined;
  const base = categoryId ? categoryVisual(key, rootKey) : UNKNOWN_VISUAL;
  return { Glyph: ICONS[category?.icon ?? base.icon] ?? CircleHelp, colour: base.colour, name: category?.name ?? null };
}

/** `row` is the kit's own lead circle, 28 px — what a form row's glyph sits in, so a category lines up with them. */
const SIZES = { lg: { box: 'h-16 w-16', glyph: 32 }, md: { box: 'h-9 w-9', glyph: 18 }, row: { box: 'h-7 w-7', glyph: 15 }, sm: { box: 'h-6 w-6', glyph: 14 }, xs: { box: 'h-5 w-5', glyph: 12 } } as const;

/**
 * A round, tinted category mark: the glyph names the category, the colour its top-level parent.
 *
 * The wash is the colour at 15 % over whatever the circle sits on — `transparent`, not white. Mixing into white is
 * what the kit's own tint does not do (`iconTint` in `native/row.ts`), and it is why every category mark stayed a
 * pale circle on a black page at night: the circle was the only light thing on the screen. At 15 % over a white
 * surface it is the identical colour it always was in the light.
 */
export function CategoryIcon({
  categoryId,
  accounts,
  transfer = false,
  size = 'md',
  title,
  label,
}: {
  categoryId: string | null;
  accounts: readonly AccountRow[];
  transfer?: boolean;
  size?: keyof typeof SIZES;
  title?: string;
  /** Written in the circle instead of the glyph, keeping the category's tint — a day number, say. */
  label?: string;
}) {
  const { key, rootKey } = categoryKeys(categoryId, accounts);
  const chosen = categoryId ? accounts.find((a) => a.id === categoryId)?.icon : null;
  const base = transfer ? TRANSFER_VISUAL : categoryId ? categoryVisual(key, rootKey) : UNKNOWN_VISUAL;
  // A category made in the picker draws the icon that was picked for it; one without keeps inheriting its
  // parent's, exactly as before — the colour is the top-level parent's either way, so a category of your own
  // still reads as part of the family it was filed in.
  const visual = chosen ? { ...base, icon: chosen } : base;
  const Glyph = ICONS[visual.icon] ?? CircleHelp;
  const { box, glyph } = SIZES[size];
  return (
    <span
      data-testid="category-mark"
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${box}`}
      style={{ background: `color-mix(in srgb, ${visual.colour} 15%, transparent)`, color: visual.colour }}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {label ? <span className="tabular text-sm font-semibold">{label}</span> : <Glyph size={glyph} strokeWidth={2.2} />}
    </span>
  );
}
