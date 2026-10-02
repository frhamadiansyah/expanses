import { sellBasisMinor, type Position } from './position';
import { parseUnits, UNITS_SCALE } from './units';

/*
 * A buy or a sell of gold bars by weight, the way a dealer's receipt reads: grams, and the total paid or received. Pure
 * arithmetic; the trade itself is recorded as any other (recordTrade).
 */

export type GoldBrand = 'Antam' | 'UBS' | 'Galeri24';

/** Each brand's own bar sizes, in grams, as its catalogue lists them. */
export const GOLD_BAR_SIZES: Readonly<Record<GoldBrand, readonly number[]>> = {
  Antam: [0.5, 1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000],
  UBS: [0.5, 1, 2, 3, 4, 5, 10, 25, 50, 100],
  Galeri24: [0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000],
};

/** The brand a holding's name says ("Antam gold bars", "UBS 10 g", "Galeri 24"), or null when it names none. */
export function goldBrandOf(name: string): GoldBrand | null {
  const text = name.toLowerCase();
  if (/\bantam\b|logam mulia/.test(text)) return 'Antam';
  if (/\bubs\b/.test(text)) return 'UBS';
  if (/\bgaleri\s?24\b/.test(text)) return 'Galeri24';
  return null;
}

/** The bar sizes to offer for a holding: its brand's, or every brand's together when its name names none. */
export function goldBarSizes(name: string): number[] {
  const brand = goldBrandOf(name);
  if (brand) return [...GOLD_BAR_SIZES[brand]];
  return [...new Set(Object.values(GOLD_BAR_SIZES).flat())].sort((a, b) => a - b);
}

/** A bar size as it is typed and shown: 0,5 · 1 · 1.000. */
export const gramsText = (grams: number): string => grams.toLocaleString('id-ID', { maximumFractionDigits: 4 });

/** Typed grams ("0,5", "12") in the millionths units are stored in, or null while it is not a weight above zero. */
export function typedGramsMicro(text: string): number | null {
  if (text.trim() === '') return null;
  try {
    const micro = parseUnits(text);
    return micro > 0 ? micro : null;
  } catch {
    return null;
  }
}

/** A size in grams as the millionths units are stored in: 0,5 g is 500.000. */
export const gramsMicro = (grams: number): number => Math.round(grams * UNITS_SCALE);

/**
 * The grams a sell takes: every gram held with All, so the holding ends at exactly 0 g, or what was typed — refused
 * (`tooMany`) when it is more than is held. Null until there is a weight.
 */
export function goldSellGrams(o: { typedMicro: number | null; all: boolean; heldMicro: number }): { unitsMicro: number; tooMany: boolean } | null {
  if (o.all) return o.heldMicro > 0 ? { unitsMicro: o.heldMicro, tooMany: false } : null;
  if (o.typedMicro === null || o.typedMicro <= 0) return null;
  return { unitsMicro: o.typedMicro, tooMany: o.typedMicro > o.heldMicro };
}

/** A sale's gain: what was received less the average cost of the grams sold, the cost basis every sell uses. */
export function goldGainMinor(position: Position, unitsMicro: number, receivedMinor: number): number {
  return receivedMinor - sellBasisMinor(position, unitsMicro);
}
