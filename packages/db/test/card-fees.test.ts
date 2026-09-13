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

  it('marks an issuer charge filed under an ordinary category, on every card alike', async () => {
    const { database, ws } = await setupDb();
    const card = await createAccount(database, ws, { name: 'Any Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const all = await listAccounts(database, ws);
    const groceries = all.find((a) => a.systemKey === 'household.groceries')!.id;
    const post = (occurredOn: string, description: string) =>
      postTransaction(database, ws, { occurredOn, description, lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: card.id, amountMinor: 10_000, currency: 'IDR' }) });

    // Every charge the issuer adds itself, filed where the owner happened to put it.
    await post('2026-09-01', 'BIAYA ADMINISTRASI KARTU');
    await post('2026-09-02', 'BEA MATERAI');
    await post('2026-09-03', 'IURAN TAHUNAN KARTU UTAMA');
    await post('2026-09-04', 'BIAYA CETAK TAGIHAN');
    await post('2026-09-05', 'Notification Fee');
    // Merchants the phrases must not reach: substrings of 'materai' and 'admin' inside ordinary names.
    await post('2026-09-06', 'MATERIAL BANGUNAN');
    await post('2026-09-07', 'TOKO ADMINISTRASI SEJAHTERA');

    const lines = await cardSpendLines(database, ws, card.id, '2026-09-01', '2026-09-30');
    expect(lines.map((l) => [l.description, l.cardFee])).toEqual([
      ['BIAYA ADMINISTRASI KARTU', true],
      ['BEA MATERAI', true],
      ['IURAN TAHUNAN KARTU UTAMA', true],
      ['BIAYA CETAK TAGIHAN', true],
      ['Notification Fee', true],
      ['MATERIAL BANGUNAN', false],
      ['TOKO ADMINISTRASI SEJAHTERA', false],
    ]);
  });
});
