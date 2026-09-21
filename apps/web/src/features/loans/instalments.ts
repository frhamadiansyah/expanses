import { sumToBase } from '@expanses/core';
import type { AccountRow } from '@expanses/db';

/**
 * Each open loan's next instalment in its own account's currency, and their total in the base currency — or no
 * total, naming the missing rate. Never minor units of two currencies added as if they were rupiah.
 */
export function monthlyInstalments(
  open: readonly { accountId: string }[],
  accounts: readonly Pick<AccountRow, 'id' | 'currency'>[],
  payments: Readonly<Record<string, number>>,
  baseCurrency: string,
  ratesToBase: Readonly<Record<string, number>>,
) {
  const rows = open.map((loan) => ({
    accountId: loan.accountId,
    minor: payments[loan.accountId] ?? 0,
    currency: accounts.find((account) => account.id === loan.accountId)?.currency ?? baseCurrency,
  }));
  return { rows, total: sumToBase({ amounts: rows, baseCurrency, ratesToBase }) };
}
