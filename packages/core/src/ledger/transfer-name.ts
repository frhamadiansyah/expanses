/**
 * What a transfer is called, worked out from the two money accounts it joins (no field, no category: a category would
 * count the cash as spending, and every purchase paid with it a second time).
 *
 *   bank or e-wallet → Cash (any currency)   Cash withdrawal
 *   Cash → Cash in another currency            Currency exchange
 *   Cash → bank or e-wallet                    Cash deposit
 *
 * Anything else (bank to bank, a top-up, a card payment, a loan, an investment) has no special name: null, and the
 * row keeps reading "Transfer". A pocket keeps its account's subtype, so a Cash pocket in lira is Cash. A fee or an
 * exchange spread beside the transfer is not a side, so it never changes the name.
 */
export interface TransferSide {
  subtype: string;
  currency: string;
}

/** Where money is held other than cash: a bank, a saving account, an e-wallet. */
const HELD = new Set(['bank', 'savings', 'time_deposit', 'ewallet', 'emoney', 'other_cash']);

export type TransferName = 'Cash withdrawal' | 'Currency exchange' | 'Cash deposit';

export function transferName(from: TransferSide | null | undefined, to: TransferSide | null | undefined): TransferName | null {
  if (!from || !to) return null;
  if (HELD.has(from.subtype) && to.subtype === 'cash') return 'Cash withdrawal';
  if (from.subtype === 'cash' && to.subtype === 'cash') return from.currency !== to.currency ? 'Currency exchange' : null;
  if (from.subtype === 'cash' && HELD.has(to.subtype)) return 'Cash deposit';
  return null;
}
