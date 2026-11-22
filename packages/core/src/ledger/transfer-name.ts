/**
 * What a transfer is called, worked out from the two money accounts it joins (no field, no category: a category would
 * count the cash as spending, and every purchase paid with it a second time). Worked out each time a row is read, so
 * a transfer recorded before a name existed reads by it too.
 *
 *   bank or e-wallet → Cash (any currency)           Cash withdrawal
 *   Cash → Cash in another currency                    Currency exchange
 *   Cash → bank or e-wallet                            Cash deposit
 *   any money (bank, e-wallet, cash) → credit card     Credit card payment (owner, 22 Nov 2026)
 *   bank or saving account → bank or saving account    Bank transfer, in any currency: a bank's dollar pocket is a bank
 *                                                      account too, and the receipt's Rate row says what was changed
 *
 * Anything else (a top-up of an e-wallet, a card into a card or a bank, a loan, an investment) has no special name:
 * null, and the row keeps reading "Transfer". A pocket keeps its account's subtype, so a Cash pocket in lira is Cash.
 * A fee or an exchange spread beside the transfer is not a side, so it never changes the name.
 *
 * A household placeholder (another member's money posted here, household sharing §4.4) is 'cash' in the ledger and
 * says nothing by it: `transferSideOf` reads it as the partner's shared item it stands for, when that is known, else as
 * no side at all — so a transfer to a partner is never a Cash withdrawal.
 */
export interface TransferSide {
  subtype: string;
  currency: string;
}

/** Where money is held other than cash: a bank, a saving account, an e-wallet. */
const HELD = new Set(['bank', 'savings', 'time_deposit', 'ewallet', 'emoney', 'other_cash']);

/** A bank account, for a Bank transfer: a current or a saving account (never a deposit, which has flows of its own). */
const BANK = new Set(['bank', 'savings']);

export type TransferName = 'Cash withdrawal' | 'Currency exchange' | 'Cash deposit' | 'Credit card payment' | 'Bank transfer';

export function transferName(from: TransferSide | null | undefined, to: TransferSide | null | undefined): TransferName | null {
  if (!from || !to) return null;
  if (HELD.has(from.subtype) && to.subtype === 'cash') return 'Cash withdrawal';
  if (from.subtype === 'cash' && to.subtype === 'cash') return from.currency !== to.currency ? 'Currency exchange' : null;
  if (from.subtype === 'cash' && HELD.has(to.subtype)) return 'Cash deposit';
  if ((HELD.has(from.subtype) || from.subtype === 'cash') && to.subtype === 'credit_card') return 'Credit card payment';
  if (BANK.has(from.subtype) && BANK.has(to.subtype)) return 'Bank transfer';
  return null;
}

/**
 * One ledger line as a side of a transfer. A household placeholder is read as the partner's shared item it stands for
 * (`partnerSubtype`, a transfer between partners), or as no side when that is not known here: never by its own subtype.
 */
export function transferSideOf(line: { accountSubtype?: string | null; currency: string; placeholder?: boolean; partnerSubtype?: string | null }): TransferSide | null {
  if (line.placeholder) return line.partnerSubtype ? { subtype: line.partnerSubtype, currency: line.currency } : null;
  return { subtype: line.accountSubtype ?? '', currency: line.currency };
}
