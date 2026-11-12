import { RING_COLOURS, type RingColour } from '@expanses/core';

/*
 * The words and tokens of owner rings (owner, 12 Nov; mockup docs/mockups/2026-11-12-owner-ring-colours.html §3): the
 * Member page's "Ring colour" row and its sheet. The colours themselves are `--owner-<colour>` in tokens.css.
 */

export const RING_LABELS: Record<RingColour, string> = {
  blue: 'Blue',
  purple: 'Purple',
  teal: 'Teal',
  indigo: 'Indigo',
  orange: 'Orange',
  brown: 'Brown',
  magenta: 'Magenta',
};

/** The CSS colour of a ring: its token, which lifts for a dark ground. */
export const ringVar = (colour: RingColour): string => `var(--owner-${colour})`;

/** The footer under the Member page's Name and Ring colour rows. */
export function ringRowFooter(name: string): string {
  return `The ring round each of ${name}’s accounts on Net worth, Assets and Liabilities, the same on every phone in the household.`;
}

/** An option another member holds, as the sheet names it in place of the colour: "Andi’s". */
export const takenLabel = (name: string): string => `${name}’s`;

/** The sheet's footer: whose colours are taken. Null when nobody else holds one (a group of one cannot be). */
export function ringSheetFooter(takenBy: readonly string[]): string | null {
  if (takenBy.length === 0) return null;
  if (takenBy.length === 1) return `${takenBy[0]}’s colour is taken, so two people never share one.`;
  const names = takenBy.map(takenLabel);
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} colours are taken, so two people never share one.`;
}

/** Every colour in the order the sheet offers it. */
export const RING_OPTIONS: readonly RingColour[] = RING_COLOURS;
