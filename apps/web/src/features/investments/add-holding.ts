import { parseMajor, parsePriceMicro, parseUnits, unitsFromLots, unitsValueMinor, UNITS_SCALE } from '@expanses/core';
import type { ListedSecurity } from '@expanses/catalog';
import type { AccountRow, AddHoldingInput, NewSecurity, SecurityRow } from '@expanses/db';
import { withCharged } from '../networth/trade-money';

export type Picked = { kind: 'held'; security: SecurityRow } | { kind: 'listed'; security: ListedSecurity } | { kind: 'named'; security: NewSecurity };

export interface NameDraft {
  ticker: string;
  name: string;
  market: string;
  currency: string;
  lotSize: string;
}

export const NEW_BROKER = 'new';
export const NO_BROKER_CHOICE = 'none';
/** "Owned before this app": paid from Opening Balances, so no bank balance moves. */
export const OPENING = 'opening';

export interface HoldingDraft {
  /** A broker account id, NEW_BROKER or NO_BROKER_CHOICE. */
  brokerChoice: string;
  brokerName: string;
  brokerCurrency: string;
  /** Lots on a lot-sized security, shares otherwise. */
  quantity: string;
  price: string;
  fee: string;
  occurredOn: string;
  /** A money account id, or OPENING. */
  paidFrom: string;
  /** What left the paying account in its own currency, when it is not the security's. */
  charged: string;
  /** The goal this buy is for, or ''. */
  goalId: string;
}

export const emptyHoldingDraft = (today: string, currency: string): HoldingDraft => ({
  brokerChoice: NO_BROKER_CHOICE, brokerName: '', brokerCurrency: currency, quantity: '', price: '', fee: '', occurredOn: today, paidFrom: OPENING, charged: '', goalId: '',
});

/** The owner's ruling: a broker is its cash account, subtype `fund` — and a pocket's parent, never the pocket. */
export function brokerChoices(accounts: readonly AccountRow[]): AccountRow[] {
  return accounts.filter((a) => a.kind === 'asset' && a.subtype === 'fund' && a.parentId === null && a.archivedAt === null);
}

export function namedSecurity(d: NameDraft): NewSecurity {
  const name = d.name.trim();
  if (!name) throw new Error('Give it a name');
  const ticker = d.ticker.trim().toUpperCase() || null;
  let lotSize: number | null = null;
  if (d.lotSize.trim()) {
    // A count of shares, read the way every typed quantity is read: "1.000" is a thousand.
    const micro = parseUnits(d.lotSize);
    if (micro <= 0 || micro % UNITS_SCALE !== 0) throw new Error('A lot is a whole number of shares');
    lotSize = micro / UNITS_SCALE;
  }
  return { ticker, name, market: d.market.trim().toUpperCase(), currency: d.currency, lotSize: lotSize === 1 ? null : lotSize, kind: ticker ? 'share' : 'other', source: 'owner' };
}

export function unitsOf(quantity: string, lotSize: number | null): number {
  if (quantity.trim() === '') throw new Error(lotSize && lotSize > 1 ? 'Enter how many lots' : 'Enter how many shares');
  const micro = parseUnits(quantity);
  if (micro <= 0) throw new Error('Enter more than zero');
  if (lotSize && lotSize > 1) {
    if (micro % UNITS_SCALE !== 0) throw new Error('Enter whole lots');
    return unitsFromLots(micro / UNITS_SCALE, lotSize);
  }
  return micro;
}

export function totalOf(draft: Pick<HoldingDraft, 'quantity' | 'price'>, lotSize: number | null, currency: string): number | null {
  try {
    return unitsValueMinor(unitsOf(draft.quantity, lotSize), parsePriceMicro(draft.price, currency));
  } catch {
    return null;
  }
}

const listedToNew = (s: ListedSecurity): NewSecurity => ({ ...s, source: 'catalogue' });
export const securityOf = (picked: Picked) => (picked.kind === 'held' ? picked.security : picked.kind === 'listed' ? listedToNew(picked.security) : picked.security);

/**
 * What `addHolding` is handed, before `tradeRatesForSave` adds the rates — with the charged amount already on the buy
 * (`withCharged`), so the set-aside door reads what really left the account. Throws with words meant for the screen.
 */
export function planAddHolding(picked: Picked, draft: HoldingDraft, today: string, cashCurrency: string): AddHoldingInput {
  const security = securityOf(picked);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.occurredOn)) throw new Error('Choose a date');
  if (draft.occurredOn > today) throw new Error('A purchase cannot be dated after today');
  const unitsMicro = unitsOf(draft.quantity, security.lotSize);
  if (draft.price.trim() === '') throw new Error('Enter the price per share');
  const grossMinor = unitsValueMinor(unitsMicro, parsePriceMicro(draft.price, security.currency));
  if (!(grossMinor > 0)) throw new Error('Enter a price greater than zero');
  const feeMinor = draft.fee.trim() === '' ? 0 : parseMajor(draft.fee, security.currency);
  if (feeMinor < 0) throw new Error('A fee cannot be negative');
  let broker: AddHoldingInput['broker'] = null;
  if (draft.brokerChoice === NEW_BROKER) {
    if (!draft.brokerName.trim()) throw new Error('Name the broker');
    broker = { name: draft.brokerName.trim(), currency: draft.brokerCurrency };
  } else if (draft.brokerChoice !== NO_BROKER_CHOICE) broker = { accountId: draft.brokerChoice };
  const cashAccountId = draft.paidFrom === OPENING ? null : draft.paidFrom;
  const { accountId: _account, kind: _kind, ...buy } = withCharged(
    { accountId: '', kind: 'buy', occurredOn: draft.occurredOn, unitsMicro, grossMinor, feeMinor, taxMinor: 0, cashAccountId, goalId: draft.goalId || null },
    draft.charged,
    security.currency,
    cashAccountId === null ? security.currency : cashCurrency,
  );
  return { security: picked.kind === 'held' ? { id: picked.security.id } : security, broker, buy };
}

/**
 * A buy with no broker lands on the oldest live holding of that stock with no broker named (`addHolding`, ordered by
 * `brokerlessHoldingsOf`). The form names it — and, when there are several, says which and how to reach the others —
 * so it never picks one silently. `names` are those holdings, oldest first.
 */
export function brokerlessNote(names: readonly string[], label: string): string | null {
  if (names.length === 0) return null;
  const [first, ...rest] = names;
  if (rest.length === 0) return `This adds to ${first}, your ${label} with no broker named.`;
  const times = names.length === 2 ? 'twice' : `${names.length} times`;
  const others = rest.length === 1 ? rest[0] : `${rest.slice(0, -1).join(', ')} or ${rest[rest.length - 1]}`;
  return `You hold ${label} ${times} with no broker named. This adds to ${first}, the first recorded; to add to ${others} instead, record the buy on Buy & sell.`;
}
