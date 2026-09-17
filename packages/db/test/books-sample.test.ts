import { addMonths, isoDate, monthOf, monthRange } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import { budgetSheetFor, categoryTotalsBetween, checkLedgerIntegrity, inBook, listPrograms, listTransactions, nativeBalances, personalBook, programBalance } from '../src/index';
import { setupDb, type TestDb } from './helpers';
import { seedSampleData } from './sample/seed';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

describe('one book changes nothing', () => {
  it('reads every figure of the sample household identically with and without its Personal book', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const today = process.env.SAMPLE_TODAY ?? isoDate();
    await seedSampleData(database, ws, today);
    const book = inBook(ws, (await personalBook(database, ws)).id);

    expect(await checkLedgerIntegrity(database, book)).toEqual([]);
    expect(await nativeBalances(database, book)).toEqual(await nativeBalances(database, ws));

    const programs = await listPrograms(database, ws);
    expect(programs.length).toBeGreaterThan(0);
    for (const program of programs) {
      expect(await programBalance(database, book, program.id, today)).toEqual(await programBalance(database, ws, program.id, today));
    }

    let sawExpenseTotals = false;
    for (const offset of [0, -1, -2]) {
      const month = addMonths(monthOf(today), offset);
      const { from, to } = monthRange(month);
      for (const kind of ['expense', 'income'] as const) {
        const bookTotals = await categoryTotalsBetween(database, book, kind, from, to);
        expect(bookTotals).toEqual(await categoryTotalsBetween(database, ws, kind, from, to));
        if (kind === 'expense' && bookTotals.length > 0) sawExpenseTotals = true;
      }
      expect(await budgetSheetFor(database, book, month)).toEqual(await budgetSheetFor(database, ws, month));
    }
    expect(sawExpenseTotals).toBe(true);

    const bookTxIds = (await listTransactions(database, book, { limit: 5000 })).map((t) => t.id);
    expect(bookTxIds.length).toBeGreaterThan(0);
    expect(bookTxIds).toEqual((await listTransactions(database, ws, { limit: 5000 })).map((t) => t.id));
  }, 60_000);
});
