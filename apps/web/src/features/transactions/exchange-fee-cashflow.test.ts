import { exchangeWithFeeLines, incomeLines } from '@expanses/core';
import { createAccount, createDatabase, createWorkspace, listAccounts, listTransactions, migrate, personalBook, postTransaction, systemAccountId } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRows, countsInOrOut, totals } from './list-model';

/*
 * An exchange with a typed fee on Cashflow (owner, 17 Nov 2026): the row is listed for its fee, and the fee is all it
 * counts — £5 of pounds that cost 21.000 each, never the Rp 295.000 the bank's rate kept on the £995. Invented figures.
 */

let close: (() => void) | undefined;
afterEach(() => {
  close?.();
  close = undefined;
});

describe('an exchange with a typed fee on Cashflow', () => {
  it('lists the row and counts the fee alone', async () => {
    const executor = createNodeExecutor();
    close = () => executor.close();
    const database = createDatabase(executor);
    await migrate(database);
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const all = await listAccounts(database, ws);
    const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
    const gbp = (await createAccount(database, ws, { name: 'BCA GBP', kind: 'asset', subtype: 'bank', currency: 'GBP' })).id;
    const idr = (await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
    const exchange = await systemAccountId(database.db, ws, 'currency_exchange');
    const RATES = { GBP: 21_000 };
    await postTransaction(database, ws, { occurredOn: '2026-03-01', description: 'Pay', lines: incomeLines({ incomeAccountId: category('income.salary'), depositAccountId: gbp, amountMinor: 100_000, currency: 'GBP' }), ratesToBase: RATES });
    await postTransaction(database, ws, {
      occurredOn: '2026-11-17',
      description: 'GBP to IDR',
      ratesToBase: RATES,
      lines: exchangeWithFeeLines({ fromAccountId: gbp, fromAmountMinor: 99_500, fromCurrency: 'GBP', toAccountId: idr, toAmountMinor: 20_600_000, toCurrency: 'IDR', exchangeAccountId: exchange, feeMinor: 500, feeCategoryId: category('miscellaneous.fees_charges') }),
    });

    const book = await personalBook(database, ws);
    const inPersonal = { ...ws, bookId: book.id };
    const txs = await listTransactions(database, inPersonal, { from: '2026-11-01', to: '2026-11-30' });
    const rows = buildRows(txs, [], await listAccounts(database, inPersonal), [], {}, book.id).filter(countsInOrOut);
    expect(rows.map((row) => [row.description, row.type, row.spentMinor, row.feeMinor, row.feeCurrency])).toEqual([['GBP to IDR', 'transfer', 105_000, 500, 'GBP']]);
    expect(totals(rows).spentMinor).toBe(105_000);
  });
});
