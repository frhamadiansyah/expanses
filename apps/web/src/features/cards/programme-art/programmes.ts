import type { FaceRef } from '../debit-art/faces';

/**
 * The drawn membership cards Points gives a programme (docs/card-art/membership, approved 24 Oct 2026): which programme
 * gets which, and the tiers each comes in.
 *
 * A programme is found by its name, the way it is typed — "KrisFlyer", "Cathay Asia Miles", "Marriott Bonvoy" — by the
 * words its family is known by, whole words only and whatever the case. Its tier (0088, chosen in its Settings) picks
 * the card within the family; no tier, or one the family has no card for, is the family's first. A name no family
 * knows keeps the plain face.
 */

/** One of a programme's tiers: its short word (what the programme keeps), its name, and the face drawn for it. */
export interface ProgrammeTier {
  id: string;
  label: string;
  key: string;
}

export interface ProgrammeFamily {
  /** The family's first face key, which is also its base tier's. */
  key: string;
  /** The programme's name as a band or a reader says it. */
  mark: string;
  /** The words that find it, each matched whole. */
  names: readonly string[];
  /** Base first. A family with a single tier has nothing to choose. */
  tiers: readonly ProgrammeTier[];
}

const tier = (key: string, id: string, label: string, base = false): ProgrammeTier => ({ id, label, key: base ? key : `${key}-${id}` });

export const PROGRAMME_FAMILIES: readonly ProgrammeFamily[] = [
  {
    key: 'krisflyer',
    mark: 'KrisFlyer',
    names: ['krisflyer', 'kris flyer'],
    tiers: [tier('krisflyer', 'member', 'KrisFlyer', true), tier('krisflyer', 'silver', 'Elite Silver'), tier('krisflyer', 'gold', 'Elite Gold')],
  },
  {
    key: 'asiamiles',
    mark: 'Asia Miles',
    names: ['asia miles', 'asiamiles', 'cathay', 'marco polo'],
    tiers: [tier('asiamiles', 'green', 'Green', true), tier('asiamiles', 'silver', 'Silver'), tier('asiamiles', 'gold', 'Gold'), tier('asiamiles', 'diamond', 'Diamond')],
  },
  {
    key: 'bonvoy',
    mark: 'Marriott Bonvoy',
    names: ['bonvoy', 'marriott'],
    tiers: [
      tier('bonvoy', 'member', 'Member', true),
      tier('bonvoy', 'silver', 'Silver Elite'),
      tier('bonvoy', 'gold', 'Gold Elite'),
      tier('bonvoy', 'platinum', 'Platinum Elite'),
      tier('bonvoy', 'titanium', 'Titanium Elite'),
      tier('bonvoy', 'ambassador', 'Ambassador Elite'),
    ],
  },
  {
    key: 'accor',
    mark: 'ALL Accor',
    names: ['accor', 'all accor', 'accor plus', 'le club'],
    tiers: [tier('accor', 'classic', 'Classic', true), tier('accor', 'silver', 'Silver'), tier('accor', 'gold', 'Gold'), tier('accor', 'platinum', 'Platinum')],
  },
  {
    key: 'garudamiles',
    mark: 'GarudaMiles',
    names: ['garuda', 'garudamiles', 'garuda miles'],
    tiers: [tier('garudamiles', 'blue', 'Blue', true), tier('garudamiles', 'silver', 'Silver'), tier('garudamiles', 'gold', 'Gold'), tier('garudamiles', 'platinum', 'Platinum')],
  },
  {
    key: 'jmb',
    mark: 'JAL Mileage Bank',
    names: ['jal', 'mileage bank', 'jmb'],
    tiers: [tier('jmb', 'member', 'JMB', true), tier('jmb', 'crystal', 'Crystal'), tier('jmb', 'sapphire', 'Sapphire'), tier('jmb', 'diamond', 'Diamond')],
  },
  {
    // Avios alone is British Airways' as much as Qatar's: only a name that says Qatar or Privilege Club finds it.
    key: 'privilegeclub',
    mark: 'Privilege Club',
    names: ['privilege club', 'qatar'],
    tiers: [
      tier('privilegeclub', 'burgundy', 'Burgundy', true),
      tier('privilegeclub', 'silver', 'Silver'),
      tier('privilegeclub', 'gold', 'Gold'),
      tier('privilegeclub', 'platinum', 'Platinum'),
    ],
  },
  {
    key: 'ana',
    mark: 'ANA Mileage Club',
    names: ['ana mileage', 'ana'],
    tiers: [tier('ana', 'member', 'ANA Mileage Club', true)],
  },
];

// Only the characters a `u` pattern lets be escaped.
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `name` is in `text` as a whole word or phrase: "ana" is in "ANA Mileage Club", not in "Banana". */
function names(text: string, name: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

/** The family a programme's name finds, or null: the longest name found whole in it wins. */
export function programmeFamily(name: string | null | undefined): ProgrammeFamily | null {
  const want = name?.trim();
  if (!want) return null;
  let best: { length: number; family: ProgrammeFamily } | null = null;
  for (const family of PROGRAMME_FAMILIES) {
    for (const known of family.names) {
      if (known.length > (best?.length ?? 0) && names(want, known)) best = { length: known.length, family };
    }
  }
  return best?.family ?? null;
}

/** The family's tier with this word, or its base when the word is unset or not one of its tiers. */
export function programmeTier(family: ProgrammeFamily, tierId: string | null | undefined): ProgrammeTier {
  return family.tiers.find((t) => t.id === tierId) ?? family.tiers[0]!;
}

/** The face key a programme is drawn as, at its tier — or null for a name no family knows, which keeps the plain face. */
export function programmeFace(name: string | null | undefined, tierId: string | null | undefined): string | null {
  const family = programmeFamily(name);
  return family ? programmeTier(family, tierId).key : null;
}

/** What a programme's card hands `CardFace`: its membership face at its tier, or null for the plain face. */
export function programmeFaceRef(name: string | null | undefined, tierId: string | null | undefined): FaceRef | null {
  const family = programmeFamily(name);
  return family ? { key: programmeTier(family, tierId).key, kind: 'membership', mark: family.mark } : null;
}
