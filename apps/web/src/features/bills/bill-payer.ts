import type { MonthlyBill } from '@expanses/db';

/** An account as the payer rules need it: the money it holds is its currency, the workspace's base when it has none. */
export interface PayerAccount {
  id: string;
  name: string;
  currency: string | null;
  kind: string;
}

export interface PayerPlan {
  /** The account that pays: the one chosen for the whole sheet, else the bill's own. */
  payerId: string;
  payerCurrency: string;
  /** The money the bill's figure is written in. */
  billCurrency: string;
  /** The bill is in other money than the payer's, so the payer is charged a figure of its own. */
  foreign: boolean;
  /** Why this bill cannot go on that payer, in words; null when it can. */
  refusal: string | null;
}

const currencyOf = (account: PayerAccount | undefined, baseCurrency: string) => account?.currency ?? baseCurrency;

/**
 * How one bill is paid from one account, the sheet's choice laid over the bill's own.
 *
 * A bill with its own currency keeps it whoever pays, and is charged in the payer's money when they differ. A bill
 * with none is written in whatever its payer holds — so one that varies (typed on the day) simply follows the chosen
 * account, as on the single Pay sheet. A FIXED bill with none is the exception: its figure was saved in its own
 * account's money, and read against another currency it would silently become a different sum. That one is refused
 * in words, and left for the bill's own sheet, rather than converted or mixed.
 */
export function payerPlan(
  bill: Pick<MonthlyBill, 'name' | 'currency' | 'amountMinor' | 'moneyAccountId'>,
  accounts: readonly PayerAccount[],
  override: string | null,
  baseCurrency: string,
): PayerPlan {
  const own = accounts.find((account) => account.id === bill.moneyAccountId);
  const payer = (override ? accounts.find((account) => account.id === override) : undefined) ?? own;
  const ownCurrency = currencyOf(own, baseCurrency);
  const payerCurrency = currencyOf(payer, baseCurrency);
  const fixedWithoutCurrency = bill.currency === null && bill.amountMinor !== null;
  const billCurrency = bill.currency ?? (fixedWithoutCurrency ? ownCurrency : payerCurrency);
  const refusal =
    fixedWithoutCurrency && payerCurrency !== ownCurrency
      ? `${bill.name} is in ${ownCurrency}; ${payer?.name ?? 'that account'} holds ${payerCurrency}. Pay it on its own.`
      : null;
  return { payerId: payer?.id ?? bill.moneyAccountId, payerCurrency, billCurrency, foreign: billCurrency !== payerCurrency, refusal };
}
