import { describe, expect, it } from 'vitest';
import { cardSpendLines, categoryIdsByKey, createAccount, nativeBalances, postTransaction } from '../src/index';
import { setupDb } from './helpers';

describe('a card top-up with a fee', () => {
  it('owes the whole charge, lands the transfer, and earns once on the whole charge under the fee’s category', async () => {
    const { database, ws } = await setupDb();
    const card = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const gopay = await createAccount(database, ws, { name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });
    const fees = (await categoryIdsByKey(database, ws))['miscellaneous.fees_charges']!;
    await postTransaction(database, ws, {
      occurredOn: '2026-10-22',
      description: 'GoPay top-up',
      lines: [
        { accountId: gopay.id, amountMinor: 1_000_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -1_010_000, currency: 'IDR', spendCategoryId: fees },
        { accountId: fees, amountMinor: 10_000, currency: 'IDR' },
      ],
    });
    const balances = await nativeBalances(database, ws);
    expect(balances[card.id]).toBe(-1_010_000);
    expect(balances[gopay.id]).toBe(1_000_000);
    const lines = await cardSpendLines(database, ws, card.id, '2026-10-01', '2026-10-31');
    expect(lines.map((line) => [line.categoryId, line.amountMinor])).toEqual([[fees, 1_010_000]]);
  });
});
