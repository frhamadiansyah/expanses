import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  activityOf,
  categoryIdsByKey,
  changeOpeningBalance,
  changeOpeningDate,
  checkLedgerIntegrity,
  createAccount,
  listCountedFrom,
  nativeBalances,
  openPocketedAccount,
  openingsOf,
  postTransaction,
  setCountedFrom,
} from '../src/index';
import { setupDb } from './helpers';

/*
 * A money account's starting balance changed from its Settings (owner, 22 Nov 2026): the opening entry on the As of day
 * is replaced with the new amount — same day, same rate — and nothing else is rewritten. Invented figures only.
 */

async function world() {
  const t = await setupDb();
  const { database, ws } = t;
  const cash = await createAccount(database, ws, { name: 'Dompet', kind: 'asset', subtype: 'cash', currency: 'IDR', openingBalanceMinor: 1_250_000, openedOn: '2026-11-01' });
  const keys = await categoryIdsByKey(database, ws);
  const food = keys['food_beverage.takeaways']!;
  const spend = (accountId: string, on: string, amountMinor: number) =>
    postTransaction(database, ws, {
      occurredOn: on,
      description: 'Warung Contoh',
      lines: [
        { accountId: food, amountMinor, currency: 'IDR' },
        { accountId, amountMinor: -amountMinor, currency: 'IDR' },
      ],
    });
  return { ...t, cash, spend, food };
}

const balance = async (t: Awaited<ReturnType<typeof world>>, accountId: string, on?: string) => (await nativeBalances(t.database, t.ws, on))[accountId] ?? 0;

describe('changing the starting balance', () => {
  it('moves every balance from the As of day by the difference, and none before it', async () => {
    const t = await world();
    await t.spend(t.cash.id, '2026-11-05', 50_000);
    await t.spend(t.cash.id, '2026-11-12', 30_000);
    const before = { oct: await balance(t, t.cash.id, '2026-10-31'), first: await balance(t, t.cash.id, '2026-11-01'), mid: await balance(t, t.cash.id, '2026-11-06'), now: await balance(t, t.cash.id) };
    expect(before).toEqual({ oct: 0, first: 1_250_000, mid: 1_200_000, now: 1_170_000 });

    await changeOpeningBalance(t.database, t.ws, t.cash.id, 1_450_000);

    expect(await balance(t, t.cash.id, '2026-10-31')).toBe(0);
    expect(await balance(t, t.cash.id, '2026-11-01')).toBe(1_450_000);
    expect(await balance(t, t.cash.id, '2026-11-06')).toBe(1_400_000);
    expect(await balance(t, t.cash.id)).toBe(1_370_000);
    // Same day; the spending stays as it was.
    expect((await openingsOf(t.database, t.ws, [t.cash.id]))[t.cash.id]).toMatchObject({ occurredOn: '2026-11-01', amountMinor: 1_450_000 });
    expect(await balance(t, t.food)).toBe(80_000);
    expect(await checkLedgerIntegrity(t.database, t.ws)).toEqual([]);
  });

  it('lowers it too, below zero if typed so, and writes nothing when the figure is the same', async () => {
    const t = await world();
    await changeOpeningBalance(t.database, t.ws, t.cash.id, 1_250_000);
    const openings = async () => (await t.database.db.values<[number]>(sql`SELECT count(*) FROM transactions WHERE description LIKE 'Opening balance:%'`))[0]![0];
    expect(await openings()).toBe(1);
    await changeOpeningBalance(t.database, t.ws, t.cash.id, -100_000);
    expect(await balance(t, t.cash.id)).toBe(-100_000);
  });

  it('gives an account opened at nothing an opening entry on its As of day', async () => {
    const t = await world();
    const gopay = await createAccount(t.database, t.ws, { name: 'Dompet Digital', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });
    await setCountedFrom(t.database, t.ws, gopay.id, '2026-10-15', '2026-11-22');
    await t.spend(gopay.id, '2026-10-20', 40_000);

    await changeOpeningBalance(t.database, t.ws, gopay.id, 300_000);

    expect((await openingsOf(t.database, t.ws, [gopay.id]))[gopay.id]).toMatchObject({ occurredOn: '2026-10-15', amountMinor: 300_000 });
    expect(await balance(t, gopay.id, '2026-10-14')).toBe(0);
    expect(await balance(t, gopay.id)).toBe(260_000);
  });

  it('dates the new entry the day the account was added, when no As of day was chosen', async () => {
    const t = await world();
    const gopay = await createAccount(t.database, t.ws, { name: 'Dompet Digital', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });
    await changeOpeningBalance(t.database, t.ws, gopay.id, 75_000);
    expect((await openingsOf(t.database, t.ws, [gopay.id]))[gopay.id]).toMatchObject({ occurredOn: gopay.createdAt.slice(0, 10), amountMinor: 75_000 });
  });

  it('at zero takes the entry away and keeps its day as the As of day', async () => {
    const t = await world();
    await changeOpeningBalance(t.database, t.ws, t.cash.id, 0);
    expect((await openingsOf(t.database, t.ws, [t.cash.id]))[t.cash.id]).toBeUndefined();
    expect((await listCountedFrom(t.database, t.ws))[t.cash.id]).toBe('2026-11-01');
    expect(await balance(t, t.cash.id)).toBe(0);
    // And back: the entry returns on that day.
    await changeOpeningBalance(t.database, t.ws, t.cash.id, 500_000);
    expect((await openingsOf(t.database, t.ws, [t.cash.id]))[t.cash.id]).toMatchObject({ occurredOn: '2026-11-01', amountMinor: 500_000 });
  });

  it('keeps the rate a foreign-currency opening was posted at', async () => {
    const t = await world();
    const usd = await createAccount(t.database, t.ws, { name: 'Dollar Savings', kind: 'asset', subtype: 'savings', currency: 'USD', openingBalanceMinor: 100_000, openedOn: '2026-09-01', openingRateToBase: 16_250 });
    await changeOpeningBalance(t.database, t.ws, usd.id, 120_000);
    const opening = (await openingsOf(t.database, t.ws, [usd.id]))[usd.id]!;
    expect(opening).toMatchObject({ occurredOn: '2026-09-01', amountMinor: 120_000, currency: 'USD', fxRateToBase: 16_250 });
    const [base] = await t.database.db.values<[number]>(sql`
      SELECT e.amount_base_minor FROM entries e JOIN transactions x ON x.id = e.transaction_id
      WHERE e.account_id = ${usd.id} AND x.status = 'posted' AND x.description LIKE 'Opening balance:%'`);
    expect(base![0]).toBe(19_500_000);
  });

  it('needs a rate for a foreign-currency account opened at nothing', async () => {
    const t = await world();
    const sgd = await createAccount(t.database, t.ws, { name: 'Dompet SGD', kind: 'asset', subtype: 'cash', currency: 'SGD' });
    await expect(changeOpeningBalance(t.database, t.ws, sgd.id, 5_000)).rejects.toThrow(/rate/);
    await changeOpeningBalance(t.database, t.ws, sgd.id, 5_000, 12_100);
    expect((await openingsOf(t.database, t.ws, [sgd.id]))[sgd.id]).toMatchObject({ amountMinor: 5_000, fxRateToBase: 12_100 });
  });

  it('refuses an account with pockets, and changes a pocket of one', async () => {
    const t = await world();
    const { parent, pockets } = await openPocketedAccount(t.database, t.ws, {
      item: 'bank',
      name: 'Bank Contoh',
      openedOn: '2026-08-01',
      pockets: [
        { currency: 'IDR', openingBalanceMinor: 2_000_000 },
        { currency: 'USD', openingBalanceMinor: 30_000, openingRateToBase: 16_000 },
      ],
    });
    await expect(changeOpeningBalance(t.database, t.ws, parent.id, 1_000)).rejects.toThrow(/pocket/);
    await changeOpeningBalance(t.database, t.ws, pockets[1]!.id, 45_000);
    expect((await openingsOf(t.database, t.ws, [pockets[1]!.id]))[pockets[1]!.id]).toMatchObject({ amountMinor: 45_000, fxRateToBase: 16_000, occurredOn: '2026-08-01' });
    expect(await balance(t, pockets[0]!.id)).toBe(2_000_000);
  });

  it('refuses anything that is not money held', async () => {
    const t = await world();
    const card = await createAccount(t.database, t.ws, { name: 'Kartu Contoh', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await expect(changeOpeningBalance(t.database, t.ws, card.id, 100_000)).rejects.toThrow(/money held/);
    await expect(changeOpeningBalance(t.database, t.ws, t.cash.id, 1.5)).rejects.toThrow(/amount/);
  });

  it('leaves Activity as the As of change does: neither is a line there', async () => {
    const t = await world();
    const before = (await activityOf(t.database, t.ws)).length;
    await changeOpeningDate(t.database, t.ws, t.cash.id, '2026-10-01', '2026-11-22');
    await changeOpeningBalance(t.database, t.ws, t.cash.id, 900_000);
    expect((await activityOf(t.database, t.ws)).length).toBe(before);
  });
});
