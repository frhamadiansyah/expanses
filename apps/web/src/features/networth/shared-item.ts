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
  /** The transfer's own note, when it has one. */
  note: string | null;
  occurredOn: string;
  /**
   * In the item's own sense, as every other figure on its page (wave 4 review, finding 2): an asset gains by money in
   * (+) and loses by money out (−); a debt owes less by money in (−) and more by money out (+).
   */
  amountMinor: number;
  currency: string;
}

/**
 * The transfers between the item and one of your own items (first mockup: "To you: Mandiri Tabungan −5.000.000"). Only
 * transfers with you: one between the owner and a third member is theirs, not a line you are party to. The period is
 * filtered by the read (`itemTransfers`), once, so none is dropped here.
 */
export function transferLines(transfers: readonly TransferIn[], item: Pick<ReceivedItem, 'kind'>, me: string): TransferLine[] {
  const sense = item.kind === 'liability' ? -1 : 1;
  return transfers
    .filter((t) => t.counterpart.owner === me)
    .sort((a, b) => (a.occurredOn === b.occurredOn ? a.transferId.localeCompare(b.transferId) : a.occurredOn < b.occurredOn ? -1 : 1))
    .map((t) => {
      const lead = t.direction === 'out' ? 'To you' : 'From you';
      return {
        key: t.transferId,
        title: t.counterpartName ? `${lead}: ${t.counterpartName}` : lead,
        note: t.description,
        occurredOn: t.occurredOn,
        amountMinor: sense * (t.direction === 'out' ? -t.amountMinor : t.amountMinor),
        currency: t.currency,
      };
    });
}

/**
 * The owner's `transferMinor` less the transfers listed with you that her summary already holds (dated on or before its
 * `asOf`, in the item's currency): transfers with others, one figure. Null when nothing is left, so it is never shown as
 * a zero row (wave 4 review, finding 1: a transfer is counted once, as its row or in this figure, never in other use).
 */
function otherTransfersOf(item: ReceivedItem, lines: readonly TransferLine[]): SharedItemView['otherTransfers'] {
  const listed = lines.reduce((sum, line) => (line.occurredOn <= item.asOf && line.currency === item.currency ? sum + line.amountMinor : sum), 0);
  const rest = item.transferMinor - listed;
  return rest === 0 ? null : { label: 'Other transfers', minor: rest, currency: item.currency };
}

export interface SharedItemView {
  name: string;
  balance: { minor: number; currency: string };
  chart: { values: number[]; months: string[] };
  /** The Household lines paid from it; `pending` = newer than the summary, so not on the owner's phone yet. */
  lines: (PurchaseLine & { pending: boolean })[];
  /** Transfers between the item and your own items, in its period. */
  transfers: TransferLine[];
  /** The owner's other transfers between partners of the period, one figure; null when none. */
  otherTransfers: { label: string; minor: number; currency: string } | null;
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
  const transfers = withYou ? transferLines(withYou.transfers, item, withYou.me) : [];
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
    transfers,
    otherTransfers: otherTransfersOf(item, transfers),
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

/**
 * What the item's page draws from the group read (finding 3): the item and its view, in either mode — Net worth's rows
 * in `joint`, Accounts' "Andi's, shared" in `separate` — and where Back goes. Null view: no group here, or the item is
 * not shared with this person any more.
 */
export function itemPage(
  shared: { group: { mode: 'joint' | 'separate'; me: string }; items: readonly ReceivedItem[]; names: Record<string, string> } | null,
  itemId: string,
  purchases: readonly PurchaseLine[],
  transfers: readonly TransferIn[],
): { item: ReceivedItem | null; view: SharedItemView | null; back: { back: string; backTo: '/net-worth' | '/accounts' } } {
  const back = shared?.group.mode === 'joint' ? { back: 'Net worth', backTo: '/net-worth' as const } : { back: 'Accounts', backTo: '/accounts' as const };
  const item = shared?.items.find((each) => each.itemId === itemId) ?? null;
  if (!shared || !item) return { item: null, view: null, back };
  const owner = shared.names[item.owner] ?? 'Someone';
  return { item, view: sharedItemView(item, purchases, owner, { transfers, me: shared.group.me }), back };
}
