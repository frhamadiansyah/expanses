import { expenseLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  archiveMerchantMcc,
  cardSpendLines,
  clearCategoryMcc,
  countMatchingPurchases,
  createAccount,
  listAccounts,
  listMerchantMccs,
  MccError,
  postTransaction,
  saveCategoryMcc,
  saveMerchantMcc,
} from '../src/index';
import { setupDb } from './helpers';

async function cardSetup() {
  const t = await setupDb();
  const { database, ws } = t;
  const card = await createAccount(database, ws, { name: 'Maybank Platinum', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const checking = await createAccount(database, ws, { name: 'Checking', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const buy = (description: string, categoryKey: string, on: string, options: { mcc?: string | null; payment?: string } = {}) =>
    postTransaction(database, ws, {
      occurredOn: on, description, mcc: options.mcc,
      lines: expenseLines({ categoryAccountId: category(categoryKey), paymentAccountId: options.payment ?? card.id, amountMinor: 100_000, currency: 'IDR' }),
    });
  const lines = async (from = '2026-09-01', to = '2026-09-30') => (await cardSpendLines(database, ws, card.id, from, to)).map((l) => [l.description, l.mcc, l.mccSource]);
  return { ...t, card, checking, category, buy, lines };
}

describe('merchant memory', () => {
  it('normalises patterns, replaces an active duplicate, archives, and rejects bad input', async () => {
    const { database, ws } = await cardSetup();
    await saveMerchantMcc(database, ws, { pattern: '  McDonald ', mcc: '5814' });
    await saveMerchantMcc(database, ws, { pattern: 'mcdonald', mcc: null });
    const rows = await listMerchantMccs(database, ws);
    expect(rows.map((r) => [r.pattern, r.mcc])).toEqual([['mcdonald', null]]);
    const renamed = await saveMerchantMcc(database, ws, { id: rows[0]!.id, pattern: "McDonald's", mcc: '5814' });
    expect(renamed).toBe(rows[0]!.id);
    expect((await listMerchantMccs(database, ws)).map((r) => [r.pattern, r.mcc])).toEqual([["mcdonald's", '5814']]);
    await archiveMerchantMcc(database, ws, rows[0]!.id);
    expect(await listMerchantMccs(database, ws)).toEqual([]);
    await expect(saveMerchantMcc(database, ws, { pattern: 'kfc', mcc: '581' })).rejects.toThrow(MccError);
    await expect(saveMerchantMcc(database, ws, { pattern: '   ', mcc: '5814' })).rejects.toThrow(MccError);
  });
});

describe('card spend lines with MCC', () => {
  it('resolves typed, memory, bundled, and category MCCs with their sources', async () => {
    const { database, ws, buy, lines } = await cardSetup();
    await saveMerchantMcc(database, ws, { pattern: 'mcdonald', mcc: '5813' });
    await buy('SUSHI TEI', 'food.dining', '2026-09-01', { mcc: '5813' });
    await buy('MCDONALD SENAYAN', 'food.dining', '2026-09-02');
    await buy('KFC KEMANG', 'food.dining', '2026-09-03');
    await buy('WARUNG BU TINI', 'food.dining', '2026-09-04');
    await buy('LAIN LAIN', 'other_expense', '2026-09-05');
    expect(await lines()).toEqual([
      ['SUSHI TEI', '5813', 'typed'],
      ['MCDONALD SENAYAN', '5813', 'memory'],
      ['KFC KEMANG', '5814', 'bundled'],
      ['WARUNG BU TINI', '5812', 'category'],
      ['LAIN LAIN', null, null],
    ]);
  });

  it('applies merchant memory saved later to past cycles', async () => {
    const { database, ws, buy, lines } = await cardSetup();
    await buy('KFC KEMANG', 'food.dining', '2026-08-10');
    expect(await lines('2026-08-01', '2026-08-31')).toEqual([['KFC KEMANG', '5814', 'bundled']]);
    await saveMerchantMcc(database, ws, { pattern: 'kfc', mcc: '5812' });
    expect(await lines('2026-08-01', '2026-08-31')).toEqual([['KFC KEMANG', '5812', 'memory']]);
  });

  it('uses category overrides and returns to the built-in default after clearing', async () => {
    const { database, ws, buy, lines, category, checking } = await cardSetup();
    await buy('WARUNG BU TINI', 'food.dining', '2026-09-04');
    await saveCategoryMcc(database, ws, category('food.dining'), '5813');
    expect(await lines()).toEqual([['WARUNG BU TINI', '5813', 'category']]);
    await clearCategoryMcc(database, ws, category('food.dining'));
    expect(await lines()).toEqual([['WARUNG BU TINI', '5812', 'category']]);
    await expect(saveCategoryMcc(database, ws, checking.id, '5812')).rejects.toThrow(MccError);
    await expect(saveCategoryMcc(database, ws, category('food.dining'), 'abcd')).rejects.toThrow(MccError);
  });

  it('counts posted expense purchases whose description matches a pattern', async () => {
    const { database, ws, buy, checking } = await cardSetup();
    await buy('KFC KEMANG', 'food.dining', '2026-09-01');
    await buy('KFC PIM', 'food.dining', '2026-09-02', { payment: checking.id });
    await buy('KFCX ONLINE', 'food.dining', '2026-09-03');
    expect(await countMatchingPurchases(database, ws, 'KFC')).toBe(2);
  });
});
