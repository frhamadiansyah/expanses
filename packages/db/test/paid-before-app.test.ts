import { describe, expect, it } from 'vitest';
import { createAccount, listTransactions, nativeBalances, postTransaction, replaceTransaction, voidTransaction } from '../src/index';
import { setupDb } from './helpers';

async function card() {
  const { database, ws } = await setupDb();
  const visa = await createAccount(database, ws, { name: 'Travel card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const dining = await createAccount(database, ws, { name: 'Dining', kind: 'expense', subtype: 'category', currency: null });
  const lines = (amount: number) => [
    { accountId: dining.id, amountMinor: amount, currency: 'IDR' },
    { accountId: visa.id, amountMinor: -amount, currency: 'IDR' },
  ];
  const owed = async () => (await nativeBalances(database, ws))[visa.id] ?? 0;
  return { database, ws, visa, dining, lines, owed };
}

describe('a card purchase already paid off before the app', () => {
  it('is spending, and leaves what the card owes as it was', async () => {
    const t = await card();
    const id = await postTransaction(t.database, t.ws, { occurredOn: '2026-03-12', description: 'Dinner', lines: t.lines(850_000), settledBeforeApp: true });
    expect(await t.owed()).toBe(0);
    const posted = await listTransactions(t.database, t.ws, {});
    expect(posted.map((tx) => tx.description).sort()).toEqual(['Dinner', 'Settled before the app']);
    expect(posted.find((tx) => tx.id === id)!.entries.find((e) => e.accountId === t.dining.id)!.amountMinor).toBe(850_000);
  });

  it('keeps its settlement level when edited, and takes it away when deleted', async () => {
    const t = await card();
    const id = await postTransaction(t.database, t.ws, { occurredOn: '2026-03-12', description: 'Dinner', lines: t.lines(850_000), settledBeforeApp: true });
    const edited = await replaceTransaction(t.database, t.ws, id, { occurredOn: '2026-03-13', description: 'Dinner', lines: t.lines(900_000) });
    expect(await t.owed()).toBe(0);
    const settlement = (await listTransactions(t.database, t.ws, {})).find((tx) => tx.description === 'Settled before the app')!;
    expect(settlement.occurredOn).toBe('2026-03-13');
    await voidTransaction(t.database, t.ws, edited);
    expect(await t.owed()).toBe(0);
    expect((await listTransactions(t.database, t.ws, {})).length).toBe(0);
  });

  it('owes as usual when not marked', async () => {
    const t = await card();
    await postTransaction(t.database, t.ws, { occurredOn: '2026-03-12', description: 'Dinner', lines: t.lines(850_000) });
    expect(await t.owed()).toBe(-850_000);
  });
});
