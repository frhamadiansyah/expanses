import { CATALOG, findEntry } from '@expanses/catalog';
import { exchangeLines, expenseLines, statementCycleFor } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCatalogEntry,
  catchUpAllCycles,
  contextOf,
  createAccount,
  createDatabase,
  createProgram,
  type Database,
  deriveCycleEntries,
  ensureCategoryKeys,
  ensureDefaultCategorySets,
  expireDueEntries,
  linkHolding,
  listAccounts,
  listWorkspaces,
  moveHeldAtToInstitutions,
  postTransaction,
  programmeOfCard,
  retireDefaultSetCategories,
  saveAssetProfile,
  saveCardTerms,
  saveEarnRule,
  saveGoal,
  setProgramExpiry,
  syncLinkedPrograms,
  systemAccountId,
  upgradeCalculatorGoals,
  type WorkspaceContext,
} from '../../src/index';
import { createNodeExecutor } from '../../src/node';
import { recalcPendingForeign } from '../../src/repos/fx-pending';
import { queueForeignRecalcTx } from '../../src/repos/fx-tables';
import { goalCalculators } from '../../src/schema-budget';
import { dumpForSelf } from '../../src/self/dump';
import { setupDb } from '../helpers';

/*
 * Link my devices, Drop 0 gate (spec §2.1, §7 risk 1). The owner's devices hold the same rows, and each runs the app's
 * own upkeep by itself: the open's category/set/held-at/goal upkeep, the catalogue's card terms, the points ledger
 * (derive, catch up, write-offs) and the foreign-currency recalculation. Run on two copies of one database at the same
 * moment, they must leave the same rows — same ids — or the copies, once linked, would hold every such row twice.
 *
 * Invented data throughout: a made-up card and figures, a lira trip, an old education goal.
 */
const NOW = new Date('2026-11-20T03:00:00.000Z');
const TODAY = '2026-11-20';

async function ownerData(): Promise<{ database: Database; ws: WorkspaceContext }> {
  const { database, ws } = await setupDb();
  const all = await listAccounts(database, ws);
  const id = (name: string) => all.find((account) => account.name === name)!.id;
  const bank = await createAccount(database, ws, { name: 'Test current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 80_000_000, openedOn: '2024-01-01' });

  // A card with a points programme whose points die after a year, spending long ago and lately: nothing derived yet.
  const card = await createAccount(database, ws, { name: 'Test Octo', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 20, dueDay: 8, creditLimitMinor: null, annualFeeMinor: null });
  const program = await createProgram(database, ws, { cardAccountId: card.id, name: 'Test Points', unit: 'points', cycleAnchor: 'statement' });
  await saveEarnRule(database, ws, program.id, {
    name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 7_500,
    rounding: 'per_transaction_floor', capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
  });
  await setProgramExpiry(database, ws, program.id, 'months_from_earn', 12);
  for (const [occurredOn, amountMinor] of [['2024-03-05', 1_730_000], ['2025-06-11', 640_000], ['2026-11-03', 2_210_000]] as const) {
    await postTransaction(database, ws, {
      occurredOn,
      description: 'Test grocer',
      lines: expenseLines({ categoryAccountId: id('Groceries'), paymentAccountId: card.id, amountMinor, currency: 'IDR' }),
    });
  }

  // A card linked to the catalogue, one entry version behind: the catalogue's upkeep writes its terms again.
  const linked = await createAccount(database, ws, { name: 'Test KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const signature = structuredClone(findEntry('bca-sq-krisflyer-visa-signature')!);
  const { programId: linkedProgram } = await applyCatalogEntry(database, ws, { cardAccountId: linked.id, entry: signature, today: '2026-01-10', replaceManual: false });
  await database.db.run(sql`UPDATE reward_programs SET catalog_entry_version = catalog_entry_version - 1 WHERE id = ${linkedProgram}`);
  // The terms an older build wrote, under ids of its own: gone, so the catalogue's upkeep writes every row afresh.
  await database.db.run(sql`DELETE FROM earn_rules WHERE program_id = ${linkedProgram}`);
  await database.db.run(sql`DELETE FROM cycle_bonuses WHERE program_id = ${linkedProgram}`);

  // A lira trip: a withdrawal and a dinner, its cost queued to be worked out again.
  const lira = (await createAccount(database, ws, { name: 'Test lira', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
  const exchange = await systemAccountId(database.db, ws, 'currency_exchange');
  await postTransaction(database, ws, {
    occurredOn: '2026-10-02',
    description: 'ATM',
    lines: exchangeLines({ fromAccountId: bank.id, fromAmountMinor: 2_730_000, fromCurrency: 'IDR', toAccountId: lira, toAmountMinor: 520_000, toCurrency: 'TRY', exchangeAccountId: exchange }),
    ratesToBase: { TRY: 507 },
  });
  await postTransaction(database, ws, {
    occurredOn: '2026-10-03',
    description: 'Dinner',
    lines: expenseLines({ categoryAccountId: id('Restaurants'), paymentAccountId: lira, amountMinor: 180_000, currency: 'TRY' }),
    ratesToBase: { TRY: 507 },
  });
  // Lira back to rupiah at a better rate: a gain, booked as a pair of entries on the exchange.
  await postTransaction(database, ws, {
    occurredOn: '2026-10-09',
    description: 'Changed back',
    lines: exchangeLines({ fromAccountId: lira, fromAmountMinor: 300_000, fromCurrency: 'TRY', toAccountId: bank.id, toAmountMinor: 1_620_000, toCurrency: 'IDR', exchangeAccountId: exchange }),
    ratesToBase: { TRY: 540 },
  });
  // Its figures gone stale (a rate saved, a build that worked them out otherwise): queued to be worked out again.
  // The pair of an older build, gone with its entries: the recalculation books it again.
  await database.db.run(sql`DELETE FROM entries WHERE id IN (SELECT category_entry_id FROM fx_gain_loss UNION SELECT exchange_entry_id FROM fx_gain_loss)`);
  await database.db.run(sql`DELETE FROM fx_gain_loss`);
  await database.db.run(sql`DELETE FROM fx_lot_uses`);
  await database.db.run(sql`DELETE FROM fx_day_values`);
  await database.db.run(sql`UPDATE entries SET amount_base_minor = amount_base_minor + 777 WHERE account_id = ${lira}`);
  await database.transaction((tx) => queueForeignRecalcTx(tx, lira, null));

  // An education goal as the old calculator left it: the open states it again in today's money.
  const goalId = await saveGoal(database, ws, {
    name: 'Test school', kind: 'education', growthBps: 900, returnBps: 900, derived: true,
    stages: [0, 1].map((i) => ({ name: `Year ${i + 1}`, targetMinor: Math.round(70_000_000 * 1.09 ** (8 + i)), targetMonths: null, dueOn: `${2034 + i}-07-01` })),
  });
  await database.db.insert(goalCalculators).values({
    goalId, workspaceId: ws.workspaceId, kind: 'education', computedMinor: 0, computedAt: '2026-01-10T08:00:00.000Z',
    inputsJson: JSON.stringify({ feeTodayMinor: 70_000_000, startsInYears: 8, yearsOfStudy: 2, feeInflationBps: 900 }),
  });

  // A fund linked to a bank account: the open moves it onto the bank's institution by name.
  const fundBank = await createAccount(database, ws, { name: 'Test savings', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: fundBank.id, assetKind: 'cash', coretaxFields: { inst: 'Test Bank' } });
  const fund = await createAccount(database, ws, { name: 'Test money market', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: fund.id, assetKind: 'fund' });
  await linkHolding(database, ws, { accountId: fund.id, brokerAccountId: fundBank.id });

  // A workspace made before default category sets existed: the open gives it its sets.
  await database.db.run(sql`DELETE FROM book_category_sets`);
  await database.db.run(sql`DELETE FROM category_set_members`);
  await database.db.run(sql`DELETE FROM category_sets`);

  return { database, ws };
}

/** What `openAppDb` runs after the migration, then what the card, points and lira screens run as they open. */
async function upkeep(database: Database): Promise<void> {
  const [workspace] = await listWorkspaces(database);
  const ws = contextOf(workspace!);
  await ensureCategoryKeys(database, ws);
  await ensureDefaultCategorySets(database, ws);
  await retireDefaultSetCategories(database, ws);
  await moveHeldAtToInstitutions(database, ws);
  for (const each of await listWorkspaces(database)) await upgradeCalculatorGoals(database, contextOf(each), TODAY);
  await syncLinkedPrograms(database, ws, CATALOG, TODAY);

  const programs = await database.db.values<[string, string]>(sql`SELECT id, card_account_id FROM reward_programs ORDER BY id`);
  for (const [programId] of programs) {
    await catchUpAllCycles(database, ws, programId, TODAY);
    await deriveCycleEntries(database, ws, programId, statementCycleFor(TODAY, 20));
    const programmeId = (await programmeOfCard(database, ws, programId))?.id ?? programId;
    await expireDueEntries(database, ws, programmeId, TODAY);
  }
  await recalcPendingForeign(database);
}

async function copyOf(database: Database): Promise<Database> {
  const executor = createNodeExecutor();
  await executor.importBytes(await database.exportBytes());
  return createDatabase(executor);
}

describe('upkeep run on two copies of one database', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('leaves the same rows, under the same ids, on both', async () => {
    const { database: phone } = await ownerData();
    const mac = await copyOf(phone);

    await upkeep(phone);
    await upkeep(mac);

    const [a, b] = [await dumpForSelf(phone), await dumpForSelf(mac)];
    const differing = Object.keys(a).filter((table) => JSON.stringify(a[table]) !== JSON.stringify(b[table]));
    expect(differing).toEqual([]);
  });

  it('the fixture gives the upkeep real work, so the test can fail', async () => {
    const { database } = await ownerData();
    const before = await dumpForSelf(database);
    await upkeep(database);
    const after = await dumpForSelf(database);
    const changed = Object.keys(after).filter((table) => JSON.stringify(after[table]) !== JSON.stringify(before[table]));
    expect(changed).toEqual(expect.arrayContaining(['point_entries', 'category_sets', 'earn_rules', 'cycle_bonuses', 'goal_stages', 'fx_lot_uses', 'fx_gain_loss', 'entries', 'audit_log', 'holding_links']));
  });
});
