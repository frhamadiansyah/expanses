import { exchangeLines, expenseLines, statementCycleFor } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  applyCatalogEntry,
  createAccount,
  createProgram,
  deriveCycleEntries,
  ensureDefaultCategorySets,
  expireDueEntries,
  listAccounts,
  listEarnRules,
  postTransaction,
  replaceTransaction,
  saveCardTerms,
  saveEarnRule,
  setProgramExpiry,
  syncLinkedPrograms,
  systemAccountId,
  voidTransaction,
} from '../../src/index';
import { findEntry } from '@expanses/catalog';
import { recalcPendingForeign } from '../../src/repos/fx-pending';
import { applySelfChangeSet, collectSelfChanges, drainSelfOutbox } from '../../src/self/channel';
import { exchange, linkedPair, sameRows, type Device } from './devices';

// Each test builds two whole databases and their triggers: seconds on a busy machine, more than the default allows.
vi.setConfig({ testTimeout: 60_000 });

/*
 * Link my devices, Drop 0's name-based ids (stableId) between linked devices: a row the app makes by itself, taken away
 * and then made again under the same name, must come back on both devices — never stopped by the removal's tombstone,
 * never clashing, never two copies — and a removal must never bring back what was made after it. One test per
 * generator. Invented data: a made-up card, shop, figures and a lira trip.
 */

const pause = () => new Promise((resolve) => setTimeout(resolve, 3));
const count = async (d: Device, query: ReturnType<typeof sql>) => Number((await d.database.db.values<[number]>(query))[0]![0]);

async function together(phone: Device, mac: Device) {
  await exchange(phone, mac);
  expect(await sameRows(phone, mac)).toEqual([]);
}

describe('a default category set taken away and given again', () => {
  async function setWithNoSets() {
    return linkedPair(async ({ database }) => {
      await database.db.run(sql`DELETE FROM book_category_sets`);
      await database.db.run(sql`DELETE FROM category_set_members`);
      await database.db.run(sql`DELETE FROM category_sets`);
    });
  }

  async function takeAway(d: Device, setId: string) {
    const members = (await d.database.db.values<[string]>(sql`SELECT category_account_id FROM category_set_members WHERE set_id = ${setId}`)).map(([id]) => id);
    await d.database.db.run(sql`DELETE FROM category_set_members WHERE set_id = ${setId}`);
    for (const account of members) {
      await d.database.db.run(sql`DELETE FROM book_categories WHERE category_account_id = ${account}`);
      await d.database.db.run(sql`DELETE FROM accounts WHERE id = ${account}`);
    }
    await d.database.db.run(sql`DELETE FROM book_category_sets WHERE set_id = ${setId}`);
    await d.database.db.run(sql`DELETE FROM category_sets WHERE id = ${setId}`);
  }

  it('comes back on both devices under the same ids, once', async () => {
    const { phone, mac } = await setWithNoSets();
    await ensureDefaultCategorySets(phone.database, phone.ws);
    await together(phone, mac);
    const [[setId]] = await phone.database.db.values<[string]>(sql`SELECT id FROM category_sets ORDER BY name LIMIT 1`);

    await takeAway(phone, setId!);
    await together(phone, mac);
    expect(await count(mac, sql`SELECT count(*) FROM category_sets WHERE id = ${setId!}`)).toBe(0);

    await pause();
    await ensureDefaultCategorySets(phone.database, phone.ws);
    await together(phone, mac);
    for (const d of [phone, mac]) expect(await count(d, sql`SELECT count(*) FROM category_sets WHERE id = ${setId!}`)).toBe(1);
  });

  it('given again on both devices at once, is one set', async () => {
    const { phone, mac } = await setWithNoSets();
    await ensureDefaultCategorySets(phone.database, phone.ws);
    await together(phone, mac);
    const [[setId]] = await phone.database.db.values<[string]>(sql`SELECT id FROM category_sets ORDER BY name LIMIT 1`);
    await takeAway(phone, setId!);
    await together(phone, mac);
    await pause();
    await ensureDefaultCategorySets(phone.database, phone.ws);
    await ensureDefaultCategorySets(mac.database, mac.ws);
    await together(phone, mac);
    for (const d of [phone, mac]) expect(await count(d, sql`SELECT count(*) FROM category_sets WHERE id = ${setId!}`)).toBe(1);
  });

  it('an old removal arriving after it was given again does not take it away', async () => {
    const { phone, mac } = await setWithNoSets();
    await ensureDefaultCategorySets(phone.database, phone.ws);
    await together(phone, mac);
    const [[setId]] = await phone.database.db.values<[string]>(sql`SELECT id FROM category_sets ORDER BY name LIMIT 1`);
    await takeAway(mac, setId!);
    await collectSelfChanges(mac.database, mac.deviceId);
    const removal = await drainSelfOutbox(mac.database);
    for (const changeSet of removal) await applySelfChangeSet(phone.database, changeSet, phone.deviceId);
    await pause();
    await ensureDefaultCategorySets(phone.database, phone.ws); // given again, after the removal
    await together(phone, mac);
    // The same removal again — a resend after a lost answer — is older than the set made since: it changes nothing.
    for (const changeSet of removal) await applySelfChangeSet(phone.database, changeSet, phone.deviceId);
    for (const changeSet of removal) await applySelfChangeSet(mac.database, changeSet, mac.deviceId);
    for (const d of [phone, mac]) expect(await count(d, sql`SELECT count(*) FROM category_sets WHERE id = ${setId!}`)).toBe(1);
    expect(await sameRows(phone, mac)).toEqual([]);
  });
});

/** A card earning one point per Rp 7.500, its points dying after a year, and one purchase in the cycle. */
async function cardWithSpending() {
  let ids = { card: '', program: '', groceries: '' };
  const pair = await linkedPair(async ({ database, ws }) => {
    const card = await createAccount(database, ws, { name: 'Test Octo', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await saveCardTerms(database, ws, { accountId: card.id, statementDay: 20, dueDay: 8, creditLimitMinor: null, annualFeeMinor: null });
    const program = await createProgram(database, ws, { cardAccountId: card.id, name: 'Test Points', unit: 'points', cycleAnchor: 'statement' });
    await saveEarnRule(database, ws, program.id, {
      name: 'Base', priority: 0, stackable: false, match: {}, rateNum: 1, rateDen: 7_500,
      rounding: 'per_transaction_floor', capSpendMinor: null, capPoints: null, minTransactionMinor: null, validFrom: null, validTo: null,
    });
    const groceries = (await listAccounts(database, ws)).find((a) => a.name === 'Groceries')!.id;
    await postTransaction(database, ws, {
      occurredOn: '2025-06-11',
      description: 'Test grocer',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: card.id, amountMinor: 1_730_000, currency: 'IDR' }),
    });
    ids = { card: card.id, program: program.id, groceries };
  });
  return { ...pair, ...ids, cycle: statementCycleFor('2025-06-11', 20) };
}

async function setRate(d: Device, programId: string, rateNum: number) {
  const [rule] = await listEarnRules(d.database, d.ws, programId);
  await saveEarnRule(d.database, d.ws, programId, { ...rule!, rateNum, id: rule!.id });
}

describe('a points batch that went away and came back', () => {
  it('comes back on both devices under its own id, whichever device works it out', async () => {
    const { phone, mac, program, cycle } = await cardWithSpending();
    await deriveCycleEntries(phone.database, phone.ws, program, cycle);
    await together(phone, mac);
    const batch = async (d: Device) => d.database.db.values<[string, number]>(sql`SELECT id, quantity FROM point_entries WHERE kind = 'earn'`);
    const [[batchId]] = await batch(phone);

    await setRate(phone, program, 0); // earns nothing: the batch goes
    await deriveCycleEntries(phone.database, phone.ws, program, cycle);
    await together(phone, mac);
    expect(await batch(mac)).toEqual([]);

    await pause();
    await setRate(phone, program, 1);
    await together(phone, mac);
    await deriveCycleEntries(phone.database, phone.ws, program, cycle);
    await deriveCycleEntries(mac.database, mac.ws, program, cycle);
    await together(phone, mac);
    for (const d of [phone, mac]) expect((await batch(d)).map(([id]) => id)).toEqual([batchId]);
  });

  it('a write-off dropped with its batch’s figure and written again is one write-off on both', async () => {
    const { phone, mac, program, cycle } = await cardWithSpending();
    await setProgramExpiry(phone.database, phone.ws, program, 'months_from_earn', 12);
    await deriveCycleEntries(phone.database, phone.ws, program, cycle);
    await expireDueEntries(phone.database, phone.ws, program, '2026-11-20');
    await together(phone, mac);
    const writeOffs = (d: Device) => d.database.db.values<[string, number]>(sql`SELECT id, quantity FROM point_entries WHERE kind = 'expire'`);
    expect(await writeOffs(phone)).toHaveLength(1);

    await pause();
    await setRate(mac, program, 2); // twice the points: the batch's figure changes, its write-off goes
    await deriveCycleEntries(mac.database, mac.ws, program, cycle);
    await expireDueEntries(mac.database, mac.ws, program, '2026-11-20');
    await together(phone, mac);
    for (const d of [phone, mac]) {
      const rows = await writeOffs(d);
      expect(rows).toHaveLength(1);
      expect(rows[0]![1]).toBe(-461); // 2 points per Rp 7.500 of Rp 1.730.000, rounded down
    }
  });
});

describe('the catalogue’s terms written again', () => {
  it('put the same rows back in use on both devices', async () => {
    let linkedProgram = '';
    const { phone, mac } = await linkedPair(async ({ database, ws }) => {
      const card = await createAccount(database, ws, { name: 'Test KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
      linkedProgram = (await applyCatalogEntry(database, ws, { cardAccountId: card.id, entry: structuredClone(findEntry('bca-sq-krisflyer-visa-signature')!), today: '2026-01-10', replaceManual: false })).programId;
    });
    const live = (d: Device) => d.database.db.values<[string]>(sql`SELECT id FROM earn_rules WHERE program_id = ${linkedProgram} AND archived_at IS NULL ORDER BY id`);
    const before = await live(phone);
    await phone.database.db.run(sql`UPDATE reward_programs SET catalog_entry_version = catalog_entry_version - 1 WHERE id = ${linkedProgram}`);
    await mac.database.db.run(sql`UPDATE reward_programs SET catalog_entry_version = catalog_entry_version - 1 WHERE id = ${linkedProgram}`);
    const { CATALOG } = await import('@expanses/catalog');
    await syncLinkedPrograms(phone.database, phone.ws, CATALOG, '2026-11-20');
    await pause();
    await syncLinkedPrograms(mac.database, mac.ws, CATALOG, '2026-11-20');
    await together(phone, mac);
    for (const d of [phone, mac]) expect(await live(d)).toEqual(before);
  });
});

describe('an exchange gain or loss whose figure goes back to an earlier one', () => {
  it('is the same pair again on both devices', async () => {
    let t = { bank: '', lira: '', exchangeAccount: '', withdrawal: '' };
    const { phone, mac } = await linkedPair(async ({ database, ws }) => {
      const bank = (await createAccount(database, ws, { name: 'Test current', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 80_000_000, openedOn: '2026-01-01' })).id;
      const lira = (await createAccount(database, ws, { name: 'Test lira', kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
      const exchangeAccount = await systemAccountId(database.db, ws, 'currency_exchange');
      const withdrawal = await postTransaction(database, ws, {
        occurredOn: '2026-10-02',
        description: 'ATM',
        lines: exchangeLines({ fromAccountId: bank, fromAmountMinor: 2_730_000, fromCurrency: 'IDR', toAccountId: lira, toAmountMinor: 520_000, toCurrency: 'TRY', exchangeAccountId: exchangeAccount }),
        ratesToBase: { TRY: 507 },
      });
      await postTransaction(database, ws, {
        occurredOn: '2026-10-09',
        description: 'Changed back',
        lines: exchangeLines({ fromAccountId: lira, fromAmountMinor: 300_000, fromCurrency: 'TRY', toAccountId: bank, toAmountMinor: 1_620_000, toCurrency: 'IDR', exchangeAccountId: exchangeAccount }),
        ratesToBase: { TRY: 540 },
      });
      t = { bank, lira, exchangeAccount, withdrawal };
    });
    const pair = (d: Device) => d.database.db.values<[string, string]>(sql`SELECT category_entry_id, exchange_entry_id FROM fx_gain_loss`);
    const first = await pair(phone);
    expect(first).toHaveLength(1);

    const withdraw = (idr: number) => ({
      occurredOn: '2026-10-02',
      description: 'ATM',
      lines: exchangeLines({ fromAccountId: t.bank, fromAmountMinor: idr, fromCurrency: 'IDR', toAccountId: t.lira, toAmountMinor: 520_000, toCurrency: 'TRY', exchangeAccountId: t.exchangeAccount }),
      ratesToBase: { TRY: 507 },
    });
    const edited = await replaceTransaction(phone.database, phone.ws, t.withdrawal, withdraw(2_900_000));
    await recalcPendingForeign(phone.database);
    await together(phone, mac);
    expect(await pair(mac)).not.toEqual(first);

    await pause();
    await replaceTransaction(mac.database, mac.ws, edited, withdraw(2_730_000));
    await recalcPendingForeign(mac.database);
    await together(phone, mac);
    for (const d of [phone, mac]) expect(await pair(d)).toEqual(first);
  });
});

describe('a purchase deleted on both devices apart', () => {
  it('has one void line in the audit log on both', async () => {
    let id = '';
    const { phone, mac } = await linkedPair(async ({ database, ws }) => {
      const bank = (await createAccount(database, ws, { name: 'Test current', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
      const groceries = (await listAccounts(database, ws)).find((a) => a.name === 'Groceries')!.id;
      id = await postTransaction(database, ws, { occurredOn: '2026-11-10', description: 'Test grocer', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank, amountMinor: 54_000, currency: 'IDR' }) });
    });
    await voidTransaction(phone.database, phone.ws, id);
    await pause();
    await voidTransaction(mac.database, mac.ws, id);
    await together(phone, mac);
    for (const d of [phone, mac]) expect(await count(d, sql`SELECT count(*) FROM audit_log WHERE entity_id = ${id} AND action = 'void'`)).toBe(1);
  });
});
