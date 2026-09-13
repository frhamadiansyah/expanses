import { expenseLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { cardSpendLines, createAccount, listAccounts, postTransaction } from '../src/index';
import { setupDb } from './helpers';

describe('card fees in spend lines', () => {
  it('marks fee categories and issuer charge descriptions as card fees', async () => {
    const { database, ws } = await setupDb();
    const card = await createAccount(database, ws, { name: 'Maybank Platinum', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const all = await listAccounts(database, ws);
    const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
    const post = (occurredOn: string, description: string, key: string) =>
      postTransaction(database, ws, { occurredOn, description, lines: expenseLines({ categoryAccountId: category(key), paymentAccountId: card.id, amountMinor: 10_000, currency: 'IDR' }) });
    await post('2026-09-01', 'BIAYA NOTIFIKASI', 'miscellaneous.fees_charges');
    await post('2026-09-02', 'KARTU UTAMA', 'miscellaneous.membership_fee');
    await post('2026-09-03', 'SUPERINDO', 'household.groceries');
    const lines = await cardSpendLines(database, ws, card.id, '2026-09-01', '2026-09-30');
    expect(lines.map((l) => [l.description, l.cardFee])).toEqual([
      ['BIAYA NOTIFIKASI', true],
      ['KARTU UTAMA', true],
      ['SUPERINDO', false],
    ]);
  });
});
