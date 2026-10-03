import { categoryVisual, TRANSFER_VISUAL, UNKNOWN_VISUAL } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import {
  ArrowLeftRight, Baby, BadgePercent, Banknote, Bath, Bed, Beer, Bike, Blocks, Book, BookOpen, Brain, Briefcase, Brush, Building, Building2, Bus,
  BusFront, Cake, Camera, Car, CarTaxiFront, Cat, ChartColumn, ChartLine, ChefHat, Church, Cigarette, CircleEllipsis, CircleHelp, CircleParking, CirclePlus, Cpu,
  Clapperboard, ClipboardPlus, Coffee, CreditCard, CupSoda, Dog, Drama, Droplets, Dumbbell, Eye, FileCheck, FileText, Film, Flame, Flower, Flower2,
  Footprints, Fuel, Gamepad2, Gavel, Gem, Gift, GraduationCap, HandCoins, HandHeart, HandHelping, Hammer, HeartHandshake, HeartPulse, House,
  IceCreamCone, IdCard, KeyRound, Landmark, Laptop, type LucideIcon, Mail, Map as MapIcon, MapPin, MessageCircleHeart, Music, Package, PaintRoller,
  Palette, PartyPopper, PawPrint, PenTool, Percent, PiggyBank, Pill, PillBottle, Pizza, Plane, Presentation, Receipt, Repeat, Sandwich, School,
  Scissors, Shield, ShieldAlert, ShieldCheck, ShieldPlus, Ship, Shirt, ShoppingBag, ShoppingBasket, ShoppingCart, Siren, Smartphone, Sofa, Soup, Sparkles,
  SprayCan, Stethoscope, Tent, Ticket, TrainFront, Trash2, TreePalm, TrendingUp, Trophy, Users, UsersRound, Utensils, UtensilsCrossed, Wallet,
  WashingMachine, Watch, Wifi, Wine, Wrench, Zap, Store, Milk, Egg, Fish, Beef, Drumstick, Apple, Carrot, Cookie, CookingPot, GlassWater, Tv, Refrigerator, Lamp, Armchair, Sprout, Plug, Syringe, Hospital, Glasses, Bandage, Coins, Target, MoonStar, Truck, Headphones, Popcorn, Guitar, ToyBrick, BrushCleaning, Motorbike, Toothbrush, Hamburger, Shrimp, Salad, Croissant, Donut, Cupcake, Candy, IceCreamBowl, Banana, Grape, Wheat, LeafyGreen, Martini, AirVent, Lightbulb, Fan, Heater, ShowerHead, Toilet, HousePlug, HouseWifi, Houses, PlantPot, Recycle, BroomSparkles, SoapDispenserDroplet, Microwave, Drill, PaintBucket, Fence, Key, Road, SquareParking, CarFront, CarBattery, TicketsPlane, Luggage, PlaneTakeoff, TramFront, Sailboat, Tablets, Thermometer, BriefcaseMedical, TestTube, Microscope, WalletCards, BanknoteArrowUp, BanknoteArrowDown, Vault, TicketPercent, Tags, ReceiptText, FileSignature, ScrollText, Backpack, NotebookPen, School2, Balloon, Ribbon, Medal, Handbag, BookHeart, Bone, Bird, Rabbit, Turtle, FerrisWheel, RollerCoaster, TentTree, Mountain, FishingRod, Piano, Drum, Dices, Puzzle, Volleyball, Radio, BriefcaseBusiness, HardHat, Laptop2, Printer, Router, TabletSmartphone, Newspaper, Mic,
} from 'lucide-react';
import { useCategoryColours } from '../../lib/queries';
import { type ChosenColours, tintOf } from '../transactions/category-colours';

/**
 * Every icon name the category data can use, mapped to a drawing bundled with the app.
 *
 * Bundled rather than loaded from an icon service: the app makes no network requests beyond exchange
 * rates. A test holds this map and the category data in step, so a name with no drawing cannot ship.
 */
export const ICONS: Readonly<Record<string, LucideIcon>> = {
  'arrow-left-right': ArrowLeftRight, baby: Baby, 'badge-percent': BadgePercent, banknote: Banknote, bed: Bed, blocks: Blocks, book: Book,
  'book-open': BookOpen, brain: Brain, briefcase: Briefcase, brush: Brush, building: Building, 'building-2': Building2, bus: Bus, 'bus-front': BusFront,
  cake: Cake, car: Car, 'car-taxi-front': CarTaxiFront, 'chart-column': ChartColumn, 'chart-line': ChartLine, 'chef-hat': ChefHat, 'circle-ellipsis': CircleEllipsis,
  'circle-help': CircleHelp, 'circle-parking': CircleParking, 'circle-plus': CirclePlus, cpu: Cpu, clapperboard: Clapperboard, 'clipboard-plus': ClipboardPlus,
  coffee: Coffee, drama: Drama, droplets: Droplets, dumbbell: Dumbbell, eye: Eye, 'file-check': FileCheck, 'file-text': FileText, film: Film,
  flame: Flame, flower: Flower, 'flower-2': Flower2, fuel: Fuel, 'gamepad-2': Gamepad2, gavel: Gavel, gem: Gem, gift: Gift,
  'graduation-cap': GraduationCap, 'hand-coins': HandCoins, 'hand-heart': HandHeart, 'hand-helping': HandHelping, hammer: Hammer,
  'heart-handshake': HeartHandshake, 'heart-pulse': HeartPulse, house: House, 'id-card': IdCard, 'key-round': KeyRound, landmark: Landmark,
  laptop: Laptop, mail: Mail, map: MapIcon, 'map-pin': MapPin, 'message-circle-heart': MessageCircleHeart, package: Package, 'paint-roller': PaintRoller,
  palette: Palette, 'party-popper': PartyPopper, percent: Percent, pill: Pill, 'pill-bottle': PillBottle, plane: Plane, presentation: Presentation,
  receipt: Receipt, repeat: Repeat, sandwich: Sandwich, school: School, scissors: Scissors, shield: Shield, 'shield-alert': ShieldAlert,
  'shield-check': ShieldCheck, 'shield-plus': ShieldPlus, shirt: Shirt, 'shopping-bag': ShoppingBag, 'shopping-basket': ShoppingBasket, 'shopping-cart': ShoppingCart,
  siren: Siren, smartphone: Smartphone, sofa: Sofa, sparkles: Sparkles, 'spray-can': SprayCan, stethoscope: Stethoscope, tent: Tent,
  ticket: Ticket, 'trash-2': Trash2, 'trending-up': TrendingUp, trophy: Trophy, users: Users, 'users-round': UsersRound, utensils: Utensils,
  'utensils-crossed': UtensilsCrossed, wallet: Wallet, wifi: Wifi, wrench: Wrench, zap: Zap,
  // Added for the icon picker's shelves (Option A).
  pizza: Pizza, beer: Beer, wine: Wine, 'cup-soda': CupSoda, 'ice-cream-cone': IceCreamCone, soup: Soup, bike: Bike, 'train-front': TrainFront,
  ship: Ship, 'washing-machine': WashingMachine, bath: Bath, watch: Watch, footprints: Footprints, 'piggy-bank': PiggyBank,
  'credit-card': CreditCard, music: Music, camera: Camera, 'tree-palm': TreePalm, 'paw-print': PawPrint, dog: Dog, cat: Cat, church: Church,
  'pen-tool': PenTool, cigarette: Cigarette,
  store: Store, milk: Milk, egg: Egg, fish: Fish, beef: Beef, drumstick: Drumstick, apple: Apple, carrot: Carrot, cookie: Cookie, 'cooking-pot': CookingPot, 'glass-water': GlassWater, tv: Tv, refrigerator: Refrigerator, lamp: Lamp, armchair: Armchair, sprout: Sprout, plug: Plug, syringe: Syringe, hospital: Hospital, glasses: Glasses, bandage: Bandage, coins: Coins, target: Target, 'moon-star': MoonStar, truck: Truck, headphones: Headphones, popcorn: Popcorn, guitar: Guitar, 'toy-brick': ToyBrick,
  'brush-cleaning': BrushCleaning, 'motorbike': Motorbike, 'toothbrush': Toothbrush,
  hamburger: Hamburger, shrimp: Shrimp, salad: Salad, croissant: Croissant, donut: Donut, cupcake: Cupcake, candy: Candy, 'ice-cream-bowl': IceCreamBowl, banana: Banana, grape: Grape, wheat: Wheat, 'leafy-green': LeafyGreen, martini: Martini, 'air-vent': AirVent, lightbulb: Lightbulb, fan: Fan, heater: Heater, 'shower-head': ShowerHead, toilet: Toilet, 'house-plug': HousePlug, 'house-wifi': HouseWifi, houses: Houses, 'plant-pot': PlantPot, recycle: Recycle, 'broom-sparkles': BroomSparkles, 'soap-dispenser-droplet': SoapDispenserDroplet, microwave: Microwave, drill: Drill, 'paint-bucket': PaintBucket, fence: Fence, key: Key, road: Road, 'square-parking': SquareParking, 'car-front': CarFront, 'car-battery': CarBattery, 'tickets-plane': TicketsPlane, luggage: Luggage, 'plane-takeoff': PlaneTakeoff, 'tram-front': TramFront, sailboat: Sailboat, tablets: Tablets, thermometer: Thermometer, 'briefcase-medical': BriefcaseMedical, 'test-tube': TestTube, microscope: Microscope, 'wallet-cards': WalletCards, 'banknote-arrow-up': BanknoteArrowUp, 'banknote-arrow-down': BanknoteArrowDown, vault: Vault, 'ticket-percent': TicketPercent, tags: Tags, 'receipt-text': ReceiptText, 'file-signature': FileSignature, 'scroll-text': ScrollText, backpack: Backpack, 'notebook-pen': NotebookPen, 'school-2': School2, balloon: Balloon, ribbon: Ribbon, medal: Medal, handbag: Handbag, 'book-heart': BookHeart, bone: Bone, bird: Bird, rabbit: Rabbit, turtle: Turtle, 'ferris-wheel': FerrisWheel, 'roller-coaster': RollerCoaster, 'tent-tree': TentTree, mountain: Mountain, 'fishing-rod': FishingRod, piano: Piano, drum: Drum, dices: Dices, puzzle: Puzzle, volleyball: Volleyball, radio: Radio, 'briefcase-business': BriefcaseBusiness, 'hard-hat': HardHat, 'laptop-2': Laptop2, printer: Printer, router: Router, 'tablet-smartphone': TabletSmartphone, newspaper: Newspaper, mic: Mic,
};

/** A category's own key and its top-level parent's, walking up from any category in the tree. */
export function categoryKeys(
  categoryId: string | null,
  accounts: readonly AccountRow[],
): { key: string | null; rootKey: string | null; rootName: string | null; rootId: string | null } {
  if (!categoryId) return { key: null, rootKey: null, rootName: null, rootId: null };
  const byId = new Map(accounts.map((account) => [account.id, account]));
  let current = byId.get(categoryId);
  const key = current?.systemKey ?? null;
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parentId);
  }
  return { key, rootKey: current?.systemKey ?? null, rootName: current && current.id !== categoryId ? current.name : null, rootId: current?.id ?? null };
}

/**
 * A category's glyph and tint, for a row that draws its own circle — the kit's rows tint an icon themselves. `chosen`
 * is the colours picked by hand (`useCategoryColours`): one picked for the top-level category wins over its base.
 */
export function categoryMark(
  categoryId: string | null,
  accounts: readonly AccountRow[],
  chosen?: ChosenColours,
): { Glyph: LucideIcon; colour: string; name: string | null } {
  const { key, rootKey, rootId } = categoryKeys(categoryId, accounts);
  const category = categoryId ? accounts.find((a) => a.id === categoryId) : undefined;
  const base = categoryId ? categoryVisual(key, rootKey) : UNKNOWN_VISUAL;
  return { Glyph: ICONS[category?.icon ?? base.icon] ?? CircleHelp, colour: tintOf(rootId, chosen, base.colour), name: category?.name ?? null };
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
  const colours = useCategoryColours().data;
  const { key, rootKey, rootId } = categoryKeys(categoryId, accounts);
  const chosen = categoryId ? accounts.find((a) => a.id === categoryId)?.icon : null;
  const computed = transfer ? TRANSFER_VISUAL : categoryId ? categoryVisual(key, rootKey) : UNKNOWN_VISUAL;
  const base = transfer ? computed : { ...computed, colour: tintOf(rootId, colours, computed.colour) };
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

/**
 * No category yet: the unknown mark in the warning tone, because it is a question still to answer. Every list that
 * holds rows waiting for a category — Review's captures, a statement check's missing rows — draws this one.
 */
export function UnknownCategoryMark() {
  return (
    <span
      data-testid="category-mark"
      aria-hidden
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ph-warn-panel)] text-[var(--ph-warn-ink)]"
    >
      <CircleHelp size={18} strokeWidth={2.2} />
    </span>
  );
}
