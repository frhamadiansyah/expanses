import { cardBar, formatMinor } from '@expanses/core';
import type { ReceivedItem } from './joint-rows';

/*
 * An item of the other's (joint-net-worth spec §8.3, D11, D13): what the read-only page says, worked out here so the
 * page only draws it. Balance, the chart of month-ends, the Household lines of the period paid from the item, one
 * "Rina's other use" total, a card's limit bar, and the details — Owner, Updated, and what is not on her phone yet.
 */

/** One Household purchase as this phone holds it: the workspace's own line, which both members see already. */
export interface PurchaseLine {
  lineageId: string;
  transactionId: string;
  occurredOn: string;
  /** The day this phone recorded or received it (YYYY-MM-DD). */
  recordedOn: string;
  description: string;
  /** What was spent, in `currency`; a refund is negative. */
  amountMinor: number;
  currency: string;
  /** Which shared item its money side is on (`money.paidFrom.itemId`, Task 7); null = an account that is not shared. */
  paidFromItemId: string | null;
  /** Whose item that is (`money.paidFrom.owner`). */
  paidFromOwner: string | null;
  /** The member who paid (the lineage's `paidBy`). */
  paidBy: string;
}

/**
 * The Household lines of the item's period whose money side is on the item (§3 "Household lines"): paid by the partner
 * or by the owner. A line naming the item under another owner is not the item's (a crafted op), so it is left out.
 */
export function linesPaidFrom(purchases: readonly PurchaseLine[], item: Pick<ReceivedItem, 'itemId' | 'owner' | 'period'>): PurchaseLine[] {
  return purchases
    .filter((p) => p.paidFromItemId === item.itemId && p.paidFromOwner === item.owner && p.occurredOn >= item.period.start && p.occurredOn <= item.period.end)
    .sort((a, b) => (a.occurredOn === b.occurredOn ? a.lineageId.localeCompare(b.lineageId) : a.occurredOn < b.occurredOn ? -1 : 1));
}

/** A transfer between partners seen from the item's side, as `itemTransfers` reads it (task 8's `member_transfer`). */
export interface TransferIn {
  transferId: string;
  occurredOn: string;
  amountMinor: number;
  currency: string;
  description: string | null;
  /** `out` = the item sent it, `in` = the item received it. */
  direction: 'out' | 'in';
  counterpart: { owner: string; itemId: string };
  /** The other side's local name when it is this phone's own item. */
  counterpartName: string | null;
}

export interface TransferLine {
  key: string;
  /** "To you: Mandiri Tabungan" / "From you: Mandiri Tabungan". */
  title: string;
  occurredOn: string;
  /** Signed as it moved the item: money out of it is negative. */
  amountMinor: number;
  currency: string;
}

/**
 * The transfers of the item's period between it and one of your own items (first mockup: "To you: Mandiri Tabungan
 * −5.000.000"). Only transfers with you: one between the owner and a third member is theirs, not a line you are party to.
 */
export function transferLines(transfers: readonly TransferIn[], item: Pick<ReceivedItem, 'period'>, me: string): TransferLine[] {
  return transfers
    .filter((t) => t.counterpart.owner === me && t.occurredOn >= item.period.start && t.occurredOn <= item.period.end)
    .sort((a, b) => (a.occurredOn === b.occurredOn ? a.transferId.localeCompare(b.transferId) : a.occurredOn < b.occurredOn ? -1 : 1))
    .map((t) => {
      const lead = t.direction === 'out' ? 'To you' : 'From you';
      return {
        key: t.transferId,
        title: t.counterpartName ? `${lead}: ${t.counterpartName}` : lead,
        occurredOn: t.occurredOn,
        amountMinor: t.direction === 'out' ? -t.amountMinor : t.amountMinor,
        currency: t.currency,
      };
    });
}

export interface SharedItemView {
  name: string;
  balance: { minor: number; currency: string };
  chart: { values: number[]; months: string[] };
  /** The Household lines paid from it; `pending` = newer than the summary, so not on the owner's phone yet. */
  lines: (PurchaseLine & { pending: boolean })[];
  /** Transfers between the item and your own items, in its period. */
  transfers: TransferLine[];
  otherUse: { label: string; under: string; text: string; credit: boolean };
  /** A card's bar (Household · other use · available), with anything waiting already subtracted. */
  bar: { householdPct: number; otherPct: number; availableMinor: number; limitMinor: number } | null;
  details: { owner: string; updated: string; notYet: string | null };
}

/**
 * A purchase is newer than the summary when it is dated or was recorded after the owner's day (`asOf`): the owner's
 * phone had not seen it when it computed the balance. A date is all a summary carries, so a purchase recorded on the
 * summary's own day counts as in it.
 */
const newerThan = (line: PurchaseLine, asOf: string) => line.occurredOn > asOf || line.recordedOn > asOf;

/**
 * Only a purchase someone else paid from the item can be missing from its owner's summary: the owner's own purchase
 * was on her phone before her summary was, however late it reached this one (review round 1, finding 3).
 */
const waitingOn = (line: PurchaseLine, item: ReceivedItem) => line.paidBy !== item.owner && newerThan(line, item.asOf);

export function sharedItemView(
  item: ReceivedItem,
  purchases: readonly PurchaseLine[],
  ownerName: string,
  withYou: { transfers: readonly TransferIn[]; me: string } | null = null,
): SharedItemView {
  const lines = linesPaidFrom(purchases, item).map((line) => ({ ...line, pending: waitingOn(line, item) }));
  const waiting = lines.filter((line) => line.pending);
  // Only purchases in the item's own currency move its balance here; another currency is the owner's phone to convert.
  const waitingMinor = waiting.reduce((sum, line) => (line.currency === item.currency ? sum + line.amountMinor : sum), 0);

  const credit = item.otherUseMinor < 0;
  const otherUse = {
    label: `${ownerName}'s other use`,
    under: credit ? 'total only · a credit' : 'total only',
    text: `${credit ? '−' : ''}${formatMinor(Math.abs(item.otherUseMinor), item.currency)}`,
    credit,
  };

  let bar: SharedItemView['bar'] = null;
  if (item.card) {
    // The bar subtracts what waits (§8.3): a card owes more by each purchase not yet on the owner's phone.
    const read = cardBar(item.card.limitMinor, {
      ...item,
      householdMinor: item.householdMinor + waitingMinor,
      balanceMinor: item.balanceMinor + waitingMinor,
    });
    bar = { ...read, limitMinor: item.card.limitMinor };
  }

  return {
    name: item.name,
    balance: { minor: item.balanceMinor, currency: item.currency },
    chart: chartOf(item),
    lines,
    transfers: withYou ? transferLines(withYou.transfers, item, withYou.me) : [],
    otherUse,
    bar,
    details: {
      owner: ownerName,
      updated: item.asOf,
      notYet: waiting.length === 0 ? null : `${waiting.length} ${waiting.length === 1 ? 'purchase' : 'purchases'} not yet on ${ownerName}'s phone`,
    },
  };
}

/** The month-ends it sent, then today's balance for the summary's month — once, even if a month-end names it (finding 7). */
function chartOf(item: ReceivedItem): SharedItemView['chart'] {
  const current = item.asOf.slice(0, 7);
  const ends = item.monthEnds.filter((end) => end.month < current);
  return { values: [...ends.map((end) => end.balanceMinor), item.balanceMinor], months: [...ends.map((end) => end.month), current] };
}
