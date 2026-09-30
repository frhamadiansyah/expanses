import { expenseLines } from '@expanses/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  assetValuesAt,
  createAccount,
  createBook,
  createDatabase,
  createWorkspace,
  migrate,
  nativeBalances,
  personalBook,
  postTransaction,
  saveCardTerms,
  type Database,
} from '../../src/index';
import { createNodeExecutor } from '../../src/node';
import { computeItemSummary } from '../../src/sync/net-worth/summaries';
import { categoryOf } from './household';

/*
 * Summary maths (joint-net-worth spec §10, task 6 review round 1): for random ledgers on a bank account and a card —
 * lines before, inside and after the period, Household or private, any statement day (29–31 included) and any
 * "today" (month ends, a leap day) — the parts add up (`openingMinor + householdMinor + otherUseMinor + transferMinor = balanceMinor`)
 * and the balance is what the Net worth reader says for that account on that day.
 */

let template: Uint8Array | undefined;

async function fresh(): Promise<Database> {
  if (!template) {
    const seed = createDatabase(createNodeExecutor());
    await migrate(seed);
    template = await seed.exportBytes();
  }
  const database = createDatabase(createNodeExecutor());
  await database.importBytes(template);
  return database;
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const line = fc.record({
  onCard: fc.boolean(),
  offset: fc.integer({ min: -100, max: 10 }),
  amountMinor: fc.integer({ min: 1, max: 50_000_000 }),
  household: fc.boolean(),
});

describe('computeItemSummary (property)', () => {
  it('the parts add up to the balance, and the balance is the Net worth reader’s', { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('2026-02-28', '2026-03-31', '2026-04-30', '2026-01-15', '2024-02-29', '2026-12-31'),
        fc.integer({ min: 1, max: 31 }),
        fc.array(line, { maxLength: 10 }),
        async (today, statementDay, lines) => {
          const database = await fresh();
          const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
          const home = (await personalBook(database, ws)).id;
          const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: home });
          const householdCategory = await categoryOf(database, home, 'Groceries');
          const privateCategory = await categoryOf(database, business, 'Groceries');
          const bank = await createAccount(database, ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
          const card = await createAccount(database, ws, { name: 'Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
          await saveCardTerms(database, ws, { accountId: card.id, statementDay, dueDay: 10, creditLimitMinor: 900_000_000, annualFeeMinor: null });
          for (const l of lines) {
            await postTransaction(database, ws, {
              occurredOn: addDays(today, l.offset),
              description: 'x',
              lines: expenseLines({
                categoryAccountId: l.household ? householdCategory : privateCategory,
                paymentAccountId: l.onCard ? card.id : bank.id,
                amountMinor: l.amountMinor,
                currency: 'IDR',
              }),
            });
          }
          const [bankSummary, cardSummary] = await database.transaction(async (tx) => [
            await computeItemSummary(tx, ws, bank.id, 'me', home, today),
            await computeItemSummary(tx, ws, card.id, 'me', home, today),
          ]);
          for (const s of [bankSummary, cardSummary]) {
            expect(s.openingMinor + s.householdMinor + s.otherUseMinor + s.transferMinor).toBe(s.balanceMinor);
            expect(s.period.start <= today && today <= s.period.end).toBe(true);
          }
          expect(bankSummary.balanceMinor).toBe((await assetValuesAt(database, ws, today)).find((r) => r.accountId === bank.id)!.valueMinor);
          expect(cardSummary.balanceMinor).toBe(0 - ((await nativeBalances(database, ws, today))[card.id] ?? 0));
          // Household is exactly the Household lines inside the period up to today, in the item's sense.
          const inPeriod = (s: typeof bankSummary, onCard: boolean) =>
            lines
              .filter((l) => l.onCard === onCard && l.household)
              .filter((l) => {
                const d = addDays(today, l.offset);
                return d >= s.period.start && d <= today;
              })
              .reduce((sum, l) => sum + (onCard ? l.amountMinor : -l.amountMinor), 0);
          expect(bankSummary.householdMinor).toBe(inPeriod(bankSummary, false));
          expect(cardSummary.householdMinor).toBe(inPeriod(cardSummary, true));
        },
      ),
      { numRuns: 25 },
    );
  });
});
