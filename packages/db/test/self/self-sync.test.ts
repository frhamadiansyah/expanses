import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  createAccount,
  LATEST_VERSION,
  listAccounts,
  migrate,
  MIGRATIONS,
  postTransaction,
  renameAccount,
  replaceTransaction,
  saveBudget,
  setBudgetOverride,
  voidTransaction,
} from '../../src/index';
import { applySelfChangeSet, collectSelfChanges, type SelfChangeSet } from '../../src/self/channel';
import { dumpForSelf } from '../../src/self/dump';
import { exchange, linkedPair, MAC_ID, PHONE_ID, sameRows, send, type Device } from './devices';

// Each test builds two whole databases and their triggers: seconds on a busy machine, more than the default allows.
vi.setConfig({ testTimeout: 60_000 });

/*
 * Link my devices, Drop 1: the self channel's capture and apply, between two in-memory devices (spec §3.2, §3.3).
 * Invented data only: made-up banks, shops and figures.
 */

const one = async (d: Device, query: ReturnType<typeof sql>) => (await d.database.db.values<unknown[]>(query))[0];
const count = async (d: Device, query: ReturnType<typeof sql>) => Number((await d.database.db.values<[number]>(query))[0]![0]);
const categoryId = async (d: Device, name: string) => (await listAccounts(d.database, d.ws)).find((a) => a.name === name)!.id;

async function purchase(d: Device, bankId: string, amountMinor: number, description = 'Test shop') {
  return postTransaction(d.database, d.ws, {
    occurredOn: '2026-11-12',
    description,
    lines: expenseLines({ categoryAccountId: await categoryId(d, 'Groceries'), paymentAccountId: bankId, amountMinor, currency: 'IDR' }),
  });
}

async function withBank() {
  let bankId = '';
  const pair = await linkedPair(async ({ database, ws }) => {
    bankId = (await createAccount(database, ws, { name: 'Test Bank', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 9_000_000, openedOn: '2026-01-01' })).id;
  });
  return { ...pair, bankId };
}

describe('capture: what one device does reaches the other as it is', () => {
  it('sends a new account, a purchase and its entries under the same ids', async () => {
    const { phone, mac, bankId } = await withBank();
    const wallet = await createAccount(phone.database, phone.ws, { name: 'Test e-wallet', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });
    const id = await purchase(phone, bankId, 145_000);

    await exchange(phone, mac);

    expect(await one(mac, sql`SELECT name FROM accounts WHERE id = ${wallet.id}`)).toEqual(['Test e-wallet']);
    expect(await one(mac, sql`SELECT description, status FROM transactions WHERE id = ${id}`)).toEqual(['Test shop', 'posted']);
    expect(await count(mac, sql`SELECT count(*) FROM entries WHERE transaction_id = ${id}`)).toBe(2);
    expect(await sameRows(phone, mac)).toEqual([]);
  });

  it('sends only the columns that changed', async () => {
    const { phone, bankId } = await withBank();
    await collectSelfChanges(phone.database, PHONE_ID); // nothing yet
    await renameAccount(phone.database, phone.ws, bankId, 'Test Bank Gold');
    const changeSet = (await collectSelfChanges(phone.database, PHONE_ID))!;
    const op = changeSet.ops.find((o) => o.t === 'accounts')!;
    expect(op).toMatchObject({ t: 'accounts', k: [bankId], c: { name: 'Test Bank Gold' } });
    expect(Object.keys(op.c!)).toEqual(['name']);
    expect(op.i).toBeUndefined();
  });

  it('sends a row taken away as a removal', async () => {
    const { phone, mac } = await withBank();
    const spare = await createAccount(phone.database, phone.ws, { name: 'Test spare', kind: 'expense', subtype: 'category', currency: null });
    await exchange(phone, mac);
    await phone.database.db.run(sql`DELETE FROM accounts WHERE id = ${spare.id}`);
    await exchange(phone, mac);
    expect(await count(mac, sql`SELECT count(*) FROM accounts WHERE id = ${spare.id}`)).toBe(0);
  });

  it('never sends this install’s own settings, and sends the owner’s', async () => {
    const { phone, mac } = await withBank();
    await phone.database.db.run(sql`INSERT INTO settings (key, value) VALUES ('last_backup_at', '2026-11-20T01:00:00Z'), ('event_mode', 'trip')
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
    await exchange(phone, mac);
    expect(await one(mac, sql`SELECT value FROM settings WHERE key = 'event_mode'`)).toEqual(['trip']);
    expect(await one(mac, sql`SELECT value FROM settings WHERE key = 'last_backup_at'`)).toBeUndefined();
  });

  it('captures nothing it applies, so a change never comes back', async () => {
    const { phone, mac, bankId } = await withBank();
    await purchase(phone, bankId, 99_000);
    await send(phone, mac);
    expect(await collectSelfChanges(mac.database, MAC_ID)).toBeNull();
  });

  it('a write outside a transaction is captured too', async () => {
    const { phone, mac, bankId } = await withBank();
    await phone.database.db.run(sql`UPDATE accounts SET icon = 'bank' WHERE id = ${bankId}`);
    await exchange(phone, mac);
    expect(await one(mac, sql`SELECT icon FROM accounts WHERE id = ${bankId}`)).toEqual(['bank']);
  });
});

describe('rule 1: each column, the later clock wins', () => {
  it('keeps both edits of one row made apart on two columns', async () => {
    const { phone, mac, bankId } = await withBank();
    await renameAccount(phone.database, phone.ws, bankId, 'Test Bank Phone');
    await mac.database.db.run(sql`UPDATE accounts SET icon = 'wallet' WHERE id = ${bankId}`);
    await exchange(phone, mac);
    for (const d of [phone, mac]) expect(await one(d, sql`SELECT name, icon FROM accounts WHERE id = ${bankId}`)).toEqual(['Test Bank Phone', 'wallet']);
  });

  it('gives the later of two edits of one column to both, whichever arrives first', async () => {
    const { phone, mac, bankId } = await withBank();
    await renameAccount(phone.database, phone.ws, bankId, 'Earlier');
    const earlier = (await collectSelfChanges(phone.database, PHONE_ID))!;
    await new Promise((resolve) => setTimeout(resolve, 3));
    await renameAccount(mac.database, mac.ws, bankId, 'Later');
    const later = (await collectSelfChanges(mac.database, MAC_ID))!;
    await applySelfChangeSet(phone.database, later, phone.deviceId);
    await applySelfChangeSet(mac.database, earlier, mac.deviceId);
    for (const d of [phone, mac]) expect(await one(d, sql`SELECT name FROM accounts WHERE id = ${bankId}`)).toEqual(['Later']);
  });
});

describe('rule 2: a removed row stays removed', () => {
  it('drops an edit made elsewhere to a row taken away', async () => {
    const { phone, mac } = await withBank();
    const spare = await createAccount(phone.database, phone.ws, { name: 'Test spare', kind: 'expense', subtype: 'category', currency: null });
    await exchange(phone, mac);
    await new Promise((resolve) => setTimeout(resolve, 3));
    await mac.database.db.run(sql`UPDATE accounts SET name = 'Renamed on Mac' WHERE id = ${spare.id}`);
    const edit = (await collectSelfChanges(mac.database, MAC_ID))!;
    await new Promise((resolve) => setTimeout(resolve, 3));
    await phone.database.db.run(sql`DELETE FROM accounts WHERE id = ${spare.id}`);
    await applySelfChangeSet(phone.database, edit, phone.deviceId);
    await exchange(phone, mac);
    for (const d of [phone, mac]) expect(await count(d, sql`SELECT count(*) FROM accounts WHERE id = ${spare.id}`)).toBe(0);
  });
});

describe('rule 3: void stays void', () => {
  it('keeps a purchase void that the other device still sends as posted', async () => {
    const { phone, mac, bankId } = await withBank();
    const id = await purchase(phone, bankId, 50_000);
    await exchange(phone, mac);
    await mac.database.db.run(sql`UPDATE transactions SET description = 'Late note' WHERE id = ${id}`);
    const stale = (await collectSelfChanges(mac.database, MAC_ID))!;
    stale.ops.push({ t: 'transactions', k: [id], c: { status: 'posted' } });
    await voidTransaction(phone.database, phone.ws, id);
    await applySelfChangeSet(phone.database, stale, phone.deviceId);
    expect(await one(phone, sql`SELECT status FROM transactions WHERE id = ${id}`)).toEqual(['void']);
  });
});

describe('rule 4: one purchase edited on two devices apart', () => {
  it('keeps the later edit, voids the other, and both devices hold the same figures', async () => {
    const { phone, mac, bankId } = await withBank();
    const id = await purchase(phone, bankId, 200_000);
    await exchange(phone, mac);
    const groceries = await categoryId(phone, 'Groceries');
    const edit = (amountMinor: number) => ({
      occurredOn: '2026-11-12',
      description: 'Test shop',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bankId, amountMinor, currency: 'IDR' }),
    });
    await replaceTransaction(phone.database, phone.ws, id, edit(210_000));
    await new Promise((resolve) => setTimeout(resolve, 3));
    const macEdit = await replaceTransaction(mac.database, mac.ws, id, edit(230_000));
    const results = await exchange(phone, mac);

    for (const d of [phone, mac]) {
      expect(await d.database.db.values(sql`SELECT id FROM transactions WHERE replaces_transaction_id = ${id} AND status = 'posted'`)).toEqual([[macEdit]]);
      expect(await one(d, sql`SELECT -sum(amount_minor) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE e.account_id = ${bankId} AND t.status = 'posted' AND t.occurred_on = '2026-11-12'`)).toEqual([230_000]);
    }
    expect(results.flatMap((r) => (r.status === 'applied' ? r.notes : [])).map((n) => n.kind)).toContain('edited-twice');
    expect(await sameRows(phone, mac)).toEqual([]);
  });
});

describe('rule 6: a change from a newer data version waits', () => {
  it('holds it, applies nothing, and keeps it for later', async () => {
    const { phone, mac, bankId } = await withBank();
    await renameAccount(phone.database, phone.ws, bankId, 'From the future');
    const changeSet = (await collectSelfChanges(phone.database, PHONE_ID))!;
    const before = await dumpForSelf(mac.database);
    expect(await applySelfChangeSet(mac.database, { ...changeSet, schema: LATEST_VERSION + 1 }, mac.deviceId)).toMatchObject({ status: 'held', reason: 'newer-version' });
    expect(await dumpForSelf(mac.database)).toEqual(before);
    expect(await applySelfChangeSet(mac.database, changeSet, mac.deviceId)).toMatchObject({ status: 'applied' });
  });

  it('applies a change from an older version, leaving the columns it does not name as they are', async () => {
    const { phone, mac, bankId } = await withBank();
    await renameAccount(phone.database, phone.ws, bankId, 'From an older build');
    const changeSet = (await collectSelfChanges(phone.database, PHONE_ID))!;
    expect(await applySelfChangeSet(mac.database, { ...changeSet, schema: LATEST_VERSION - 1 }, mac.deviceId)).toMatchObject({ status: 'applied' });
    expect(await one(mac, sql`SELECT name, currency FROM accounts WHERE id = ${bankId}`)).toEqual(['From an older build', 'IDR']);
  });
});

describe('migrations', () => {
  it('are not captured, and a column they add is captured after', async () => {
    const { phone, mac, bankId } = await withBank();
    const extra = { version: LATEST_VERSION + 50, name: 'test_extra_column', sql: "ALTER TABLE accounts ADD COLUMN test_note TEXT; UPDATE accounts SET test_note = 'migrated';" };
    for (const d of [phone, mac]) await migrate(d.database, [...MIGRATIONS, extra]);
    expect(await collectSelfChanges(phone.database, PHONE_ID)).toBeNull();
    await phone.database.db.run(sql`UPDATE accounts SET test_note = 'typed on phone' WHERE id = ${bankId}`);
    await exchange(phone, mac);
    expect(await one(mac, sql`SELECT test_note FROM accounts WHERE id = ${bankId}`)).toEqual(['typed on phone']);
  });
});

describe('a budget, an override and a purchase on each side, exchanged', () => {
  it('ends with the same rows on both', async () => {
    const { phone, mac, bankId } = await withBank();
    const groceries = await categoryId(phone, 'Groceries');
    const dining = await categoryId(phone, 'Restaurants');
    await saveBudget(phone.database, phone.ws, { categoryAccountId: groceries, amountMinor: 3_000_000 });
    await saveBudget(mac.database, mac.ws, { categoryAccountId: dining, amountMinor: 1_200_000 });
    await purchase(phone, bankId, 75_000, 'Phone shop');
    await purchase(mac, bankId, 64_000, 'Mac shop');
    await exchange(phone, mac);
    await setBudgetOverride(mac.database, mac.ws, { categoryAccountId: groceries, month: '2026-12', amountMinor: 4_000_000 });
    await exchange(phone, mac);
    expect(await sameRows(phone, mac)).toEqual([]);
    expect(await count(phone, sql`SELECT count(*) FROM budget_overrides`)).toBe(1);
  });
});
