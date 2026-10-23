import { namedMatches } from '../coretax/banks';

/**
 * Gold bar makers, offered while a gold holding's name is typed, the way banks are offered for an account: anything
 * else typed is kept as typed. The makers sold everywhere are always offered; Indonesia's own only in a workspace kept
 * in rupiah, as the banks and brokers are.
 */
export type GoldMaker = { name: string; also: readonly string[] };

export const WORLD_GOLD_BRANDS: readonly GoldMaker[] = [
  { name: 'PAMP Suisse', also: ['PAMP'] },
  { name: 'Valcambi', also: [] },
  { name: 'Perth Mint', also: [] },
  { name: 'Royal Mint', also: [] },
  { name: 'Heraeus', also: [] },
  { name: 'Argor-Heraeus', also: ['Argor'] },
  { name: 'Metalor', also: [] },
];

export const INDONESIAN_GOLD_BRANDS: readonly GoldMaker[] = [
  { name: 'Antam', also: ['Logam Mulia', 'LM'] },
  { name: 'UBS', also: [] },
  { name: 'Galeri 24', also: ['Galeri24'] },
  { name: 'Lotus Archi', also: ['Lotus'] },
  { name: 'King Halim', also: [] },
  { name: 'Hartadinata', also: ['Emasku'] },
];

/** The makers a typed gold name offers: the rupiah workspace's own first, matched as banks are, at most `limit`. */
export function goldBrandMatches(typed: string, local: boolean, limit = 3): GoldMaker[] {
  return namedMatches(local ? [...INDONESIAN_GOLD_BRANDS, ...WORLD_GOLD_BRANDS] : WORLD_GOLD_BRANDS, typed, limit);
}
