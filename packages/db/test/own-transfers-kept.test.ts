import { expenseLines, transferLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cardStatementLines,
  createAccount,
  createBook,
  createCardAccount,
  inBook,
  listAccounts,
  listTransactions,
  nativeBalances,
  ownerScope,
  personalBook,
  postTransaction,
  saveCardTerms,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * Own transfers off Cashflow (owner, 2026-11-13) is a display rule in Cashflow alone: "keep in the credit card / bank
 * statement, do not remove from them". Whatever workspace is open, and however a transfer was filed — typed in one
 * workspace, or posted by the app in none (a bill's Pay, a statement's Pay, a capture) — a card's statement, an
 * account's own history and the balances still list it. Every name and figure is invented.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function setup() {
  current = await setupDb();
  const { database, ws } = current;
  const personal = (await personalBook(database, ws)).id;
  const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const card = await createCardAccount(database, ws, { name: 'Contoh Visa', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 20, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
  const bank = await createAccount(database, ws, { name: 'Contoh Payroll', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const wallet = await createAccount(database, ws, { name: 'Dompet', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });
  const groceries = (await listAccounts(database, inBook(ws, business))).find((a) => a.systemKey === 'household.groceries')!.id;
  // Spending on the card in Business, then the card paid from the bank: once typed in Personal, once by the app.
  await postTransaction(database, inBook(ws, business), {
    occurredOn: '2026-10-09',
    description: 'Toko Contoh',
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: card.id, amountMinor: 320_000_00, currency: 'IDR' }),
  });
  await postTransaction(database, inBook(ws, personal), {
    occurredOn: '2026-10-25',
    description: 'Card payment typed',
    fileTransfer: true,
    lines: transferLines({ fromAccountId: bank.id, toAccountId: card.id, amountMinor: 200_000_00, currency: 'IDR' }),
  });
  await postTransaction(database, ws, {
    occurredOn: '2026-10-26',
    description: 'Card payment by Pay',
    lines: transferLines({ fromAccountId: bank.id, toAccountId: card.id, amountMinor: 120_000_00, currency: 'IDR' }),
  });
  await postTransaction(database, inBook(ws, business), {
    occurredOn: '2026-10-27',
    description: 'Dompet top-up',
    fileTransfer: true,
    lines: transferLines({ fromAccountId: bank.id, toAccountId: wallet.id, amountMinor: 50_000_00, currency: 'IDR' }),
  });
  return { database, ws, personal, business, card: card.id, bank: bank.id, wallet: wallet.id };
}

describe('an own transfer stays on every statement and account page', () => {
  it('the card’s statement lists both payments, whichever workspace is open', async () => {
    const s = await setup();
    for (const book of [s.personal, s.business]) {
      const lines = (await cardStatementLines(s.database, inBook(s.ws, book), s.card)).map((line) => line.description);
      expect(lines).toEqual(expect.arrayContaining(['Toko Contoh', 'Card payment typed', 'Card payment by Pay']));
    }
  });

  it('the bank’s and the wallet’s own histories list every transfer, whichever workspace is open', async () => {
    const s = await setup();
    for (const book of [s.personal, s.business]) {
      const at = ownerScope(inBook(s.ws, book));
      const bank = (await listTransactions(s.database, at, { accountIds: [s.bank] })).map((t) => t.description);
      expect(bank).toEqual(expect.arrayContaining(['Card payment typed', 'Card payment by Pay', 'Dompet top-up']));
      const wallet = (await listTransactions(s.database, at, { accountIds: [s.wallet] })).map((t) => t.description);
      expect(wallet).toEqual(['Dompet top-up']);
    }
  });

  it('the balances move by every transfer', async () => {
    const s = await setup();
    const balances = await nativeBalances(s.database, s.ws);
    expect(balances[s.bank]).toBe(-(200_000_00 + 120_000_00 + 50_000_00));
    expect(balances[s.wallet]).toBe(50_000_00);
    expect(balances[s.card]).toBe(-320_000_00 + 200_000_00 + 120_000_00);
  });
});
