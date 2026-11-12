/*
 * Owner rings (owner, 12 Nov): on the household's Net worth, Assets and Liabilities every account's round icon wears a
 * thin ring in its owner's colour. Each member may pick their own colour; one who never picks keeps the colour of their
 * place in the group, as every build before this one drew it. Two members never share one colour.
 *
 * Every phone works out the same colours from the same facts — the group's members and each member's own pick, which
 * travels in the group log — so a person is one colour on every phone in the household.
 */

/** The palette, in the order it is offered and handed out. No red, rose or green: those mean debt, warning and up. */
export const RING_COLOURS = ['blue', 'purple', 'teal', 'indigo', 'orange', 'brown', 'magenta'] as const;
export type RingColour = (typeof RING_COLOURS)[number];

export function isRingColour(value: unknown): value is RingColour {
  return typeof value === 'string' && (RING_COLOURS as readonly string[]).includes(value);
}

/** A member's own pick: the colour, and when it was made (an ISO time), which settles a race for one colour. */
export interface RingPick {
  colour: RingColour;
  at: string;
}

/**
 * A pick as the group log carries it (`{"colour","at",…}`), or null. A colour this build does not know — one a newer
 * build added — reads as no pick, so the member keeps a colour this build can draw; anything malformed reads as none.
 */
export function parseRingPick(json: string | null | undefined): RingPick | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as { colour?: unknown; at?: unknown } | null;
    if (!value || !isRingColour(value.colour) || typeof value.at !== 'string' || value.at === '') return null;
    return { colour: value.colour, at: value.at };
  } catch {
    return null;
  }
}

/** An ISO time as `toISOString` writes it: the only `at` whose byte order is time order. */
const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Which of two picks came first, the same on every phone: by `at` in plain byte order (never a locale's collation,
 * which may differ between phones), an `at` that is not an ISO time after every one that is, then by member id.
 */
function pickOrder(atA: string, a: string, atB: string, b: string): number {
  const badA = !ISO_AT.test(atA);
  const badB = !ISO_AT.test(atB);
  if (badA !== badB) return badA ? 1 : -1;
  if (atA !== atB) return atA < atB ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Each member's ring colour, the same on every phone given the same members and picks:
 * 1. picks, earliest first (`pickOrder`: byte order of `at`, a malformed `at` last, then the lower member id): each
 *    takes its colour unless an earlier pick holds it;
 * 2. members with no pick, in group order: each takes the colour of their place in the group (as before) unless a pick
 *    holds it;
 * 3. everyone left — a pick that lost its race, a default a pick landed on — takes the first colour nobody holds.
 * With more members than colours the palette goes round again. Picks by anyone not in `members` are ignored.
 */
export function resolveRings(members: readonly string[], picks: Readonly<Record<string, RingPick | null | undefined>>): Record<string, RingColour> {
  const out: Record<string, RingColour> = {};
  const taken = new Set<RingColour>();
  const left: string[] = [];
  const take = (member: string, colour: RingColour) => {
    out[member] = colour;
    taken.add(colour);
  };
  const pickers = members.filter((member) => picks[member]).sort((a, b) => pickOrder(picks[a]!.at, a, picks[b]!.at, b));
  for (const member of pickers) {
    const colour = picks[member]!.colour;
    if (taken.has(colour)) left.push(member);
    else take(member, colour);
  }
  members.forEach((member, index) => {
    if (picks[member]) return;
    const colour = RING_COLOURS[index % RING_COLOURS.length]!;
    if (taken.has(colour)) left.push(member);
    else take(member, colour);
  });
  for (const member of left) {
    const free = RING_COLOURS.find((colour) => !taken.has(colour));
    if (free) take(member, free);
    else out[member] = RING_COLOURS[members.indexOf(member) % RING_COLOURS.length]!;
  }
  return out;
}

/** The colours the other members hold, each with whose it is: what `me` cannot pick. */
export function takenRings(members: readonly string[], picks: Readonly<Record<string, RingPick | null | undefined>>, me: string): Partial<Record<RingColour, string>> {
  const rings = resolveRings(members, picks);
  const out: Partial<Record<RingColour, string>> = {};
  for (const member of members) if (member !== me && rings[member]) out[rings[member]] = member;
  return out;
}
