import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, listAccounts, postTransaction } from '../../src/index';
import { CLASH_RULES, uniqueKeysOf } from '../../src/self/clashes';
import { applySelfChangeSet, collectSelfChanges } from '../../src/self/channel';
import { dumpForSelf } from '../../src/self/dump';
import { SELF_TABLES } from '../../src/self/tables';
import { exchange, linkedPair, MAC_ID, PHONE_ID, sameRows, type Device } from './devices';

/*
 * Link my devices, rule 5 (spec §3.3): two devices made "the same" row under different ids. One test per unique key,
 * saying what happens. A clash never deletes a transaction, an entry or any row money hangs on, and never takes children
 * with it: merge (settings-like rows), keep both (the key is only a "seen before" mark), or hold (wait, shown).
 * Invented rows throughout.
 */

const pause = () => new Promise((resolve) => setTimeout(resolve, 3));
const rows = (d: Device, query: ReturnType<typeof sql>) => d.database.db.values<unknown[]>(query);

async function setting() {
  let bankId = '';
  let groceries = '';
  let purchaseId = '';
  const pair = await linkedPair(async ({ database, ws }) => {
    bankId = (await createAccount(database, ws, { name: 'Test Bank', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-01-01' })).id;
    groceries = (await listAccounts(database, ws)).find((a) => a.name === 'Groceries')!.id;
    purchaseId = await postTransaction(database, ws, {
      occurredOn: '2026-11-02',
      description: 'Test grocer',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bankId, amountMinor: 81_000, currency: 'IDR' }),
    });
  });
  return { ...pair, bankId, groceries, purchaseId, wsId: pair.phone.ws.workspaceId };
}

/** The phone makes its row first; the Mac makes its own a moment later, so the Mac's is the later one. */
async function bothMake(phone: Device, mac: Device, make: (d: Device, n: 1 | 2) => Promise<void>) {
  await make(phone, 1);
  const fromPhone = (await collectSelfChanges(phone.database, PHONE_ID))!;
  await pause();
  await make(mac, 2);
  const fromMac = (await collectSelfChanges(mac.database, MAC_ID))!;
  return { fromPhone, fromMac };
}

describe('every unique key has one answer', () => {
  it('sorts each unique key of every table that travels', async () => {
    const { phone } = await setting();
    const keys: string[] = [];
    for (const [table, kind] of Object.entries(SELF_TABLES)) {
      if (kind !== 'replicate' && kind !== 'seat') continue;
      for (const key of await uniqueKeysOf(phone.database.db, table)) keys.push(key.id);
    }
    expect(keys.filter((key) => !CLASH_RULES[key]).sort()).toEqual([]);
    expect(Object.keys(CLASH_RULES).filter((key) => !keys.includes(key)).sort()).toEqual([]);
  });
});

describe('merge', () => {
  it('budgets (workspace, category): one budget, the later amount, the other budget’s month moved onto it', async () => {
    const { phone, mac, groceries, wsId } = await setting();
    await bothMake(phone, mac, async (d, n) => {
      await d.database.db.run(sql`INSERT INTO budgets (id, workspace_id, category_account_id, amount_minor, created_at, updated_at)
        VALUES (${`budget-${n}`}, ${wsId}, ${groceries}, ${n * 1_000_000}, '2026-11-20', '2026-11-20')`);
      await d.database.db.run(sql`INSERT INTO budget_overrides (id, workspace_id, budget_id, month, amount_minor) VALUES (${`override-${n}`}, ${wsId}, ${`budget-${n}`}, ${`2026-1${n}`}, ${n * 10})`);
    });
    await exchange(phone, mac);
    for (const d of [phone, mac]) {
      expect(await rows(d, sql`SELECT id, amount_minor FROM budgets WHERE category_account_id = ${groceries}`)).toEqual([['budget-1', 2_000_000]]);
      expect(await rows(d, sql`SELECT id, budget_id, month FROM budget_overrides ORDER BY id`)).toEqual([
        ['override-1', 'budget-1', '2026-11'],
        ['override-2', 'budget-1', '2026-12'],
      ]);
    }
    expect(await sameRows(phone, mac)).toEqual([]);
  });

  it('budget_overrides (budget, month): one override, the later amount', async () => {
    const { phone, mac, groceries, wsId } = await setting();
    await phone.database.db.run(sql`INSERT INTO budgets (id, workspace_id, category_account_id, amount_minor, created_at, updated_at) VALUES ('budget-0', ${wsId}, ${groceries}, 500, '2026-11-20', '2026-11-20')`);
    await exchange(phone, mac);
    await bothMake(phone, mac, (d, n) =>
      d.database.db.run(sql`INSERT INTO budget_overrides (id, workspace_id, budget_id, month, amount_minor) VALUES (${`override-${n}`}, ${wsId}, 'budget-0', '2026-12', ${n * 100})`).then(() => undefined),
    );
    await exchange(phone, mac);
    for (const d of [phone, mac]) expect(await rows(d, sql`SELECT id, amount_minor FROM budget_overrides`)).toEqual([['override-1', 200]]);
    expect(await sameRows(phone, mac)).toEqual([]);
  });

  it('merchant_mccs (workspace, live pattern): one pattern, the later code', async () => {
    const { phone, mac, wsId } = await setting();
    await bothMake(phone, mac, (d, n) =>
      d.database.db.run(sql`INSERT INTO merchant_mccs (id, workspace_id, pattern, mcc, created_at) VALUES (${`mcc-${n}`}, ${wsId}, 'test grocer', ${n === 1 ? '5411' : '5499'}, '2026-11-20')`).then(() => undefined),
    );
    await exchange(phone, mac);
    for (const d of [phone, mac]) expect(await rows(d, sql`SELECT id, mcc FROM merchant_mccs`)).toEqual([['mcc-1', '5499']]);
    expect(await sameRows(phone, mac)).toEqual([]);
  });

  it('income_sources (workspace, account): one source, the later settings', async () => {
    const { phone, mac, groceries, wsId } = await setting();
    const income = (await listAccounts(phone.database, phone.ws)).find((a) => a.kind === 'income')!.id;
    void groceries;
    await bothMake(phone, mac, (d, n) =>
      d.database.db
        .run(sql`INSERT INTO income_sources (id, workspace_id, name, scheme, account_id, created_at) VALUES (${`source-${n}`}, ${wsId}, ${`Test shop ${n}`}, 'umkm_final', ${income}, '2026-11-20')`)
        .then(() => undefined),
    );
    await exchange(phone, mac);
    for (const d of [phone, mac]) expect(await rows(d, sql`SELECT id, name FROM income_sources`)).toEqual([['source-1', 'Test shop 2']]);
    expect(await sameRows(phone, mac)).toEqual([]);
  });
});

describe('keep both', () => {
  it('draft_transactions (workspace, message ref): both drafts stay, the later loses its ref', async () => {
    const { phone, mac, wsId } = await setting();
    await bothMake(phone, mac, (d, n) =>
      d.database.db
        .run(sql`INSERT INTO draft_transactions (id, workspace_id, source, status, occurred_on, description, amount_minor, currency, external_ref, created_at)
          VALUES (${`draft-${n}`}, ${wsId}, 'email', 'pending', '2026-11-19', 'Test grocer', 81_000, 'IDR', 'msg-test-1', '2026-11-20')`)
        .then(() => undefined),
    );
    const results = await exchange(phone, mac);
    for (const d of [phone, mac]) expect(await rows(d, sql`SELECT id, external_ref FROM draft_transactions ORDER BY id`)).toEqual([['draft-1', 'msg-test-1'], ['draft-2', null]]);
    expect(results.flatMap((r) => (r.status === 'applied' ? r.notes : [])).map((n) => n.kind)).toContain('maybe-duplicate');
    expect(await sameRows(phone, mac)).toEqual([]);
  });

  it('transactions (workspace, posted ref): both purchases stay posted, the later loses its ref', async () => {
    const { phone, mac, bankId, groceries } = await setting();
    await bothMake(phone, mac, async (d) => {
      await postTransaction(d.database, d.ws, {
        occurredOn: '2026-11-19',
        description: 'Test grocer (statement)',
        externalRef: 'stmt-test-7',
        lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bankId, amountMinor: 42_000, currency: 'IDR' }),
      });
    });
    await exchange(phone, mac);
    for (const d of [phone, mac]) {
      const found = await rows(d, sql`SELECT external_ref, status FROM transactions WHERE description = 'Test grocer (statement)' ORDER BY created_at, id`);
      expect(found.map((r) => r[1])).toEqual(['posted', 'posted']);
      expect(found.map((r) => r[0]).sort()).toEqual([null, 'stmt-test-7'].sort());
    }
    expect(await sameRows(phone, mac)).toEqual([]);
  });
});

describe('hold: money, or rows money hangs on', () => {
  /** Applies the Mac's row on the phone: held, and the phone exactly as it was. Then the same the other way. */
  async function expectHeld(phone: Device, mac: Device, make: (d: Device, n: 1 | 2) => Promise<unknown>, key: string) {
    const { fromPhone, fromMac } = await bothMake(phone, mac, async (d, n) => void (await make(d, n)));
    for (const [d, changeSet] of [[phone, fromMac], [mac, fromPhone]] as const) {
      const before = await dumpForSelf(d.database);
      expect(await applySelfChangeSet(d.database, changeSet, d.deviceId)).toMatchObject({ status: 'held', reason: 'clash', key });
      expect(await dumpForSelf(d.database)).toEqual(before);
    }
  }

  it('accounts (workspace, system key)', async () => {
    const { phone, mac, wsId } = await setting();
    await expectHeld(phone, mac, (d, n) => d.database.db.run(sql`INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, system_key, sort_order, created_at)
      VALUES (${`sys-${n}`}, ${wsId}, 'equity', 'equity', 'Test equity', 'IDR', 'derived', 'test_system_key', 0, '2026-11-20')`), 'accounts:workspace_id,system_key');
  });

  it('asset_sales (account)', async () => {
    const { phone, mac, bankId, purchaseId, wsId } = await setting();
    const asset = (await createAccount(phone.database, phone.ws, { name: 'Test car', kind: 'asset', subtype: 'vehicle', currency: 'IDR' })).id;
    await exchange(phone, mac);
    await expectHeld(phone, mac, (d, n) => d.database.db.run(sql`INSERT INTO asset_sales (id, workspace_id, account_id, sold_on, sold_for_minor, cash_account_id, transaction_id, created_at)
      VALUES (${`sale-${n}`}, ${wsId}, ${asset}, '2026-11-19', ${n * 1000}, ${bankId}, ${purchaseId}, '2026-11-20')`), 'asset_sales:account_id');
  });

  it('deposit_events (account, kind, due day)', async () => {
    const { phone, mac, bankId, wsId } = await setting();
    await expectHeld(phone, mac, (d, n) => d.database.db.run(sql`INSERT INTO deposit_events (id, workspace_id, account_id, kind, due_on, principal_minor, gross_minor, tax_minor, net_minor, confirmed_at)
      VALUES (${`dep-${n}`}, ${wsId}, ${bankId}, 'maturity', '2026-12-01', 100, ${n}, 0, ${n}, '2026-11-20')`), 'deposit_events:account_id,kind,due_on');
  });

  it('securities (workspace, market, ticker)', async () => {
    const { phone, mac, wsId } = await setting();
    await expectHeld(phone, mac, (d, n) => d.database.db.run(sql`INSERT INTO securities (id, workspace_id, ticker, name, market, currency, kind, source, created_at)
      VALUES (${`sec-${n}`}, ${wsId}, 'TEST', ${`Test Tbk ${n}`}, 'IDX', 'IDR', 'share', 'owner', '2026-11-20')`), 'securities:workspace_id,market,ticker');
  });

  it('tax_year_reports (workspace, year)', async () => {
    const { phone, mac, wsId } = await setting();
    await expectHeld(phone, mac, (d, n) => d.database.db.run(sql`INSERT INTO tax_year_reports (id, workspace_id, tax_year, created_at) VALUES (${`tax-${n}`}, ${wsId}, 2026, '2026-11-20')`), 'tax_year_reports:workspace_id,tax_year');
  });

  it('statement_checks (card, period)', async () => {
    const { phone, mac, wsId } = await setting();
    const card = (await createAccount(phone.database, phone.ws, { name: 'Test card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' })).id;
    await exchange(phone, mac);
    await expectHeld(phone, mac, (d, n) => d.database.db.run(sql`INSERT INTO statement_checks (id, workspace_id, card_account_id, period_start, period_end, status, checked_at)
      VALUES (${`check-${n}`}, ${wsId}, ${card}, '2026-10-21', '2026-11-20', 'open', '2026-11-20')`), 'statement_checks:card_account_id,period_start,period_end');
  });

  it('seat-owned keys: one writer, so a clash is a fault and waits', async () => {
    const { phone, mac } = await setting();
    await expectHeld(phone, mac, (d, n) => d.database.db.run(sql`INSERT INTO group_logs (book_id, group_book_id) VALUES (${`book-${n}`}, 'group-test')`), 'group_logs:group_book_id');
  });
});
