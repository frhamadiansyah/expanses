/** The plastic cards of one account, as far as sorting its purchases goes. */
export interface PlasticRef {
  id: string;
  isPrimary: boolean;
}

/**
 * The purchases that belong to one plastic card of an account, for a list that follows the card shown.
 *
 * A purchase that names the card belongs to it. A purchase that names no card (older, or made while the account had
 * one card) or names one that is no longer on the account (removed) belongs to the primary, so none disappears. An
 * account with a single plastic keeps every purchase. Informational only: it never changes what a purchase earns.
 */
export function purchasesForPlastic<T extends { cardId?: string | null }>(lines: readonly T[], plastics: readonly PlasticRef[], shownId: string | null | undefined): T[] {
  if (plastics.length <= 1 || !shownId) return [...lines];
  const ids = new Set(plastics.map((piece) => piece.id));
  const primaryId = (plastics.find((piece) => piece.isPrimary) ?? plastics[0]!).id;
  return lines.filter((line) => {
    const owner = line.cardId && ids.has(line.cardId) ? line.cardId : primaryId;
    return owner === shownId;
  });
}
