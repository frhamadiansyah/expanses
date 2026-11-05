import type { BookMoney, DraftRow } from '@expanses/db';

/**
 * What the drafts waiting add up to, in the workspace's own currency, or null when they cannot be added up.
 *
 * A draft read in another currency — a purchase abroad, in the merchant's figure — is brought across at a stored
 * rate, and the sum is then approximate. With no rate for it there is no sum at all: its units are never counted as
 * the workspace's own, and half a sum is worse than none. A workspace that reads in the owner's currency converts
 * nothing for the ledger, so the foreign conversion has to be asked for by name (`convertForeign`).
 */
export function notRecordedTotal(
  drafts: readonly Pick<DraftRow, 'amountMinor' | 'currency' | 'occurredOn'>[],
  money: BookMoney,
): { minor: number; approximate: boolean } | null {
  const convert = money.converts ? money.convert : money.convertForeign;
  let minor = 0;
  let approximate = false;
  for (const draft of drafts) {
    const figure = Math.abs(draft.amountMinor);
    if (draft.currency === money.currency) {
      minor += figure;
      continue;
    }
    const converted = convert ? convert(figure, draft.currency, draft.occurredOn) : null;
    if (converted === null) return null;
    minor += converted;
    approximate = true;
  }
  return { minor, approximate };
}
