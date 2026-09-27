import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { postTransaction, replaceTransaction, voidTransaction } from '../../src/index';
import { categoryOf, headOf, Household, postedRowsOf, projectBook, type Device } from './household';

/* Spec §13 `void-wins`: correct→void and void→correct, every arrival order → void on all (rule 3). */

async function setup() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const bookId = await home.share(fandri);
  const groceries = await categoryOf(fandri.database, bookId, 'Groceries');
  const lineage = await postTransaction(fandri.database, fandri.ws, {
    occurredOn: '2026-09-10',
    description: 'Superindo',
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: fandri.bank, amountMinor: 50_000, currency: 'IDR' }),
  });
  await home.join(dewi, fandri);
  await home.settle();
  return { home, fandri, dewi, bookId, groceries, lineage };
}

async function correct(d: Device, lineage: string, amountMinor: number) {
  const head = (await headOf(d.database, lineage))!;
  const entries = await d.database.db.values<[string, number, string]>(
    sql`SELECT e.account_id, e.amount_minor, a.kind FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${head}`,
  );
  const category = entries.find(([, , kind]) => kind === 'expense')![0];
  const money = entries.find(([, , kind]) => kind !== 'expense')![0];
  await replaceTransaction(d.database, d.ws, head, {
    occurredOn: '2026-09-10',
    description: 'Corrected',
    lines: expenseLines({ categoryAccountId: category, paymentAccountId: money, amountMinor, currency: 'IDR' }),
  });
}

async function voidIt(d: Device, lineage: string) {
  await voidTransaction(d.database, d.ws, (await headOf(d.database, lineage))!);
}

async function expectVoidEverywhere(home: Household, bookId: string, lineage: string) {
  for (const d of home.devices) {
    expect(await headOf(d.database, lineage)).toBeNull();
    expect(await postedRowsOf(d.database, bookId, lineage)).toEqual([]);
    expect((await projectBook(d.database, bookId)).purchase![lineage]).toBe('void');
  }
}

describe('void wins', () => {
  for (const [name, order] of [
    ['the correction arrives first', ['fandri', 'dewi']],
    ['the void arrives first', ['dewi', 'fandri']],
  ] as const) {
    it(`one device corrects while the other voids, offline; ${name}`, async () => {
      const { home, fandri, dewi, bookId, lineage } = await setup();
      await correct(fandri, lineage, 65_000);
      await voidIt(dewi, lineage);
      const by = { fandri, dewi };
      for (const who of order) await by[who].engine.syncOnce(bookId);
      await home.settle();
      await expectVoidEverywhere(home, bookId, lineage);
    });

    it(`one device voids while the other corrects later, offline; ${name}`, async () => {
      const { home, fandri, dewi, bookId, lineage } = await setup();
      await voidIt(fandri, lineage);
      await correct(dewi, lineage, 65_000);
      await correct(dewi, lineage, 75_000);
      const by = { fandri, dewi };
      for (const who of order) await by[who].engine.syncOnce(bookId);
      await home.settle();
      await expectVoidEverywhere(home, bookId, lineage);
    });
  }

  it('a correction arriving after the void was applied changes nothing', async () => {
    const { home, fandri, dewi, bookId, lineage } = await setup();
    await correct(dewi, lineage, 65_000);
    await voidIt(fandri, lineage);
    await fandri.engine.syncOnce(bookId);
    await dewi.engine.syncOnce(bookId);
    await home.settle();
    await expectVoidEverywhere(home, bookId, lineage);
  });
});
