import { type CatalogEntry, findEntry } from '@expanses/catalog';
import { describe, expect, it } from 'vitest';
import { computeCycleEarn, expenseLines } from '@expanses/core';
import {
  applyCatalogEntry,
  cardSpendLines,
  CatalogError,
  createAccount,
  listAccounts,
  listCategoryChoices,
  listCycleBonuses,
  listEarnRules,
  postTransaction,
  setCatalogCategoryChoice,
  syncLinkedPrograms,
} from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-14';

/** A card paying double on one category the holder picks, changeable each cycle. */
function withChoice(): CatalogEntry {
  const base = structuredClone(findEntry('bca-unionpay')!);
  return {
    ...base,
    id: 'choice-test-card',
    program: {
      ...base.program,
      categoryChoice: {
        key: 'double',
        name: 'Double category',
        changeable: 'once a billing cycle',
        options: [
          { key: 'dining', name: 'Food & Beverages', match: { categoryKeys: ['food.dining'] } },
          { key: 'groceries', name: 'Groceries', match: { categoryKeys: ['food.groceries'] } },
        ],
      },
    },
    terms: [
      {
        effectiveFrom: null,
        effectiveTo: null,
        rules: [
          { key: 'double-category', name: 'Double category', rateNum: 1, rateDen: 5_000, rounding: 'per_increment', priority: 10, stackable: false, match: {}, categoryChoice: 'double' },
          { key: 'base', name: 'Base', rateNum: 1, rateDen: 10_000, rounding: 'per_increment', priority: 0, stackable: false, match: {} },
        ],
        cycleBonuses: [],
      },
    ],
    transferPartners: [],
  };
}

async function applied() {
  const t = await setupDb();
  const card = await createAccount(t.database, t.ws, { name: 'Choice Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const { programId } = await applyCatalogEntry(t.database, t.ws, { cardAccountId: card.id, entry: withChoice(), today: TODAY, replaceManual: false });
  return { ...t, card, programId };
}

const categoryRules = async (t: Awaited<ReturnType<typeof applied>>) =>
  (await listEarnRules(t.database, t.ws, t.programId))
    .filter((rule) => rule.name.startsWith('Double category'))
    .map((rule) => [rule.name, rule.validFrom, rule.validTo]);

describe('running a category the holder picked', () => {
  it('writes no category rule until one is picked', async () => {
    const t = await applied();
    expect(await categoryRules(t)).toEqual([]);
    expect(await listCategoryChoices(t.database, t.ws, t.programId)).toEqual([]);
  });

  it('the first pick runs from the start, so the whole card is covered', async () => {
    const t = await applied();
    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'dining', TODAY, TODAY);
    expect(await categoryRules(t)).toEqual([['Double category: Food & Beverages', null, null]]);
  });

  it('changing the category closes the old stretch the day before the new one starts', async () => {
    const t = await applied();
    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'dining', TODAY, TODAY);
    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'groceries', '2026-10-01', '2026-10-01');

    expect(await categoryRules(t)).toEqual([
      ['Double category: Food & Beverages', null, '2026-09-30'],
      ['Double category: Groceries', '2026-10-01', null],
    ]);
  });

  it('a cycle that closed keeps the category that was running, even after a newer entry syncs', async () => {
    const t = await applied();
    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'dining', TODAY, TODAY);
    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'groceries', '2026-10-01', '2026-10-01');

    const v2 = withChoice();
    v2.entryVersion = withChoice().entryVersion + 1;
    await syncLinkedPrograms(t.database, t.ws, [v2], '2026-10-05');

    expect(await categoryRules(t)).toEqual([
      ['Double category: Food & Beverages', null, '2026-09-30'],
      ['Double category: Groceries', '2026-10-01', null],
    ]);
  });

  it('refuses an option the card does not offer', async () => {
    const t = await applied();
    await expect(setCatalogCategoryChoice(t.database, t.ws, t.programId, 'petrol', TODAY, TODAY)).rejects.toBeInstanceOf(CatalogError);
  });

  it('refuses to start a stretch before the one already running', async () => {
    const t = await applied();
    // The first pick runs from the start, so it has no start date to come before; the second one does.
    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'dining', TODAY, TODAY);
    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'groceries', '2026-10-01', TODAY);
    await expect(setCatalogCategoryChoice(t.database, t.ws, t.programId, 'dining', '2026-09-20', TODAY)).rejects.toBeInstanceOf(CatalogError);
  });

  it('lets the first pick, which runs from the start, be followed by any later date', async () => {
    const t = await applied();
    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'dining', '2026-10-01', TODAY);
    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'groceries', '2026-09-20', TODAY);
    expect(await categoryRules(t)).toEqual([
      ['Double category: Food & Beverages', null, '2026-09-19'],
      ['Double category: Groceries', '2026-09-20', null],
    ]);
  });

  it('refuses a card with no category to choose', async () => {
    const t = await setupDb();
    const card = await createAccount(t.database, t.ws, { name: 'Plain', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const { programId } = await applyCatalogEntry(t.database, t.ws, { cardAccountId: card.id, entry: structuredClone(findEntry('bca-unionpay')!), today: TODAY, replaceManual: false });
    await expect(setCatalogCategoryChoice(t.database, t.ws, programId, 'dining', TODAY, TODAY)).rejects.toBeInstanceOf(CatalogError);
  });

  it('changes immediately, so one cycle can earn on both categories', async () => {
    const t = await applied();
    const all = await listAccounts(t.database, t.ws);
    const dining = all.find((a) => a.systemKey === 'food.dining')!.id;
    const groceries = all.find((a) => a.systemKey === 'food.groceries')!.id;
    const ancestors = Object.fromEntries(all.map((a) => [a.id, a.parentId ? [a.parentId] : []]));

    // Food & Beverages from the start, swapped to Groceries in the middle of the September cycle.
    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'dining', TODAY, TODAY);
    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'groceries', '2026-09-20', '2026-09-20');

    // Rp 100.000 on each, one either side of the swap, both inside the same cycle.
    for (const [occurredOn, categoryAccountId] of [
      ['2026-09-15', dining],
      ['2026-09-25', groceries],
    ] as const) {
      await postTransaction(t.database, t.ws, {
        occurredOn,
        description: 'Belanja',
        lines: expenseLines({ categoryAccountId, paymentAccountId: t.card.id, amountMinor: 100_000, currency: 'IDR' }),
      });
    }

    const lines = await cardSpendLines(t.database, t.ws, t.card.id, '2026-09-01', '2026-09-30');
    const rules = await listEarnRules(t.database, t.ws, t.programId);
    const bonuses = await listCycleBonuses(t.database, t.ws, t.programId);
    const earn = computeCycleEarn(lines, rules, ancestors, { bonuses, cycleEnd: '2026-09-30' });

    // Both earned at the double rate (Rp 5.000 per point) in their own stretch: 20 + 20, not 10 + 20.
    expect(earn.totalPoints).toBe(40);
  });

  it('a purchase in the category that is no longer running earns only the base rate', async () => {
    const t = await applied();
    const all = await listAccounts(t.database, t.ws);
    const dining = all.find((a) => a.systemKey === 'food.dining')!.id;
    const ancestors = Object.fromEntries(all.map((a) => [a.id, a.parentId ? [a.parentId] : []]));

    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'dining', TODAY, TODAY);
    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'groceries', '2026-09-20', '2026-09-20');

    await postTransaction(t.database, t.ws, {
      occurredOn: '2026-09-25',
      description: 'Din Tai Fung',
      lines: expenseLines({ categoryAccountId: dining, paymentAccountId: t.card.id, amountMinor: 100_000, currency: 'IDR' }),
    });

    const lines = await cardSpendLines(t.database, t.ws, t.card.id, '2026-09-01', '2026-09-30');
    const rules = await listEarnRules(t.database, t.ws, t.programId);
    const bonuses = await listCycleBonuses(t.database, t.ws, t.programId);
    // Rp 100.000 at the base Rp 10.000 per point, because Groceries was running by then.
    expect(computeCycleEarn(lines, rules, ancestors, { bonuses, cycleEnd: '2026-09-30' }).totalPoints).toBe(10);
  });

  it('keeps the base rule alongside, at a lower priority', async () => {
    const t = await applied();
    await setCatalogCategoryChoice(t.database, t.ws, t.programId, 'dining', TODAY, TODAY);
    const rules = await listEarnRules(t.database, t.ws, t.programId);
    const chosen = rules.find((rule) => rule.name.startsWith('Double category'))!;
    const base = rules.find((rule) => rule.name === 'Base')!;
    expect(chosen.priority).toBeGreaterThan(base.priority);
    expect(chosen.stackable).toBe(false);
  });
});
