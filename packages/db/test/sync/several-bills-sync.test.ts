import { splitExpenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  createCardAccount,
  listAccounts,
  monthlyBills,
  postTransaction,
  recordBillsAsOnePayment,
  runSharedBookRepairs,
  saveExpenseTemplate,
  voidTransaction,
} from '../../src/index';
import { SyncEngine } from '../../src/sync/engine';
import { type Device, Household, skipsOf } from './household';

vi.setConfig({ testTimeout: 60_000 });

/*
 * One payment, several bills (2026-11-22), between phones. Invented: in the shared workspace three bills — Internet
 * Rp 385.000, Mobile phone Rp 150.000 and Mobile phone 2 Rp 100.000 — paid at once on Kartu Contoh 4417.
 */

const TODAY = '2026-11-22';
const BUILD = '0.5.7';
const OLDER = '0.5.6';

async function threeBills(d: { database: Device['database']; ws: Device['ws'] }, moneyAccountId: string) {
  const all = await listAccounts(d.database, d.ws);
  const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const save = (name: string, key: string, amountMinor: number) =>
    saveExpenseTemplate(d.database, d.ws, { name, categoryAccountId: category(key), moneyAccountId, amountMinor, dayOfMonth: 20, startsMonth: '2026-11' });
  return {
    internet: await save('Internet', 'utilities.internet_provider', 385_000),
    phone: await save('Mobile phone', 'utilities.mobile_phone', 150_000),
    phone2: await save('Mobile phone 2', 'utilities.mobile_phone', 100_000),
  };
}

const payments = (b: Awaited<ReturnType<typeof threeBills>>) => [
  { templateId: b.internet, billMonth: '2026-11', amountMinor: 385_000 },
  { templateId: b.phone, billMonth: '2026-11', amountMinor: 150_000 },
  { templateId: b.phone2, billMonth: '2026-11', amountMinor: 100_000 },
];

async function paidOf(d: { database: Device['database']; ws: Device['ws'] }, ids: string[]) {
  const list = await monthlyBills(d.database, d.ws, TODAY);
  return ids.map((id) => {
    const bill = list.find((b) => b.id === id);
    return bill ? { state: bill.state, paidMinor: bill.paidMinor } : null;
  });
}

async function household(husbandVersion: string) {
  const home = new Household();
  const wife = await home.device('Wife', undefined, 'IDR', BUILD);
  const husband = await home.device('Husband', undefined, 'IDR', husbandVersion);
  await home.share(wife);
  await home.join(husband, wife);
  await home.settle();
  const card = (await createCardAccount(wife.database, wife.ws, { name: 'Kartu Contoh', subtype: 'credit_card', currency: 'IDR', last4: '4417' })).id;
  const b = await threeBills(wife, wife.bank);
  await home.settle();
  return { home, wife, husband, card, b };
}

const PAID = [
  { state: 'paid', paidMinor: 385_000 },
  { state: 'paid', paidMinor: 150_000 },
  { state: 'paid', paidMinor: 100_000 },
];

describe('household sharing', () => {
  it('a payment of three bills reaches the other phone as one purchase with all three paid; deleted there, all three are owed again here', async () => {
    const { home, wife, husband, card, b } = await household(BUILD);
    const [payment] = await recordBillsAsOnePayment(wife.database, wife.ws, { paidOn: TODAY, moneyAccountId: card, description: 'Bayar sekaligus', payments: payments(b) });
    await home.settle();

    const ids = [b.internet, b.phone, b.phone2];
    expect(await paidOf(husband, ids)).toEqual(PAID);
    const [onHis] = (await monthlyBills(husband.database, husband.ws, TODAY)).filter((x) => x.id === b.internet).map((x) => x.paymentId);
    expect((await monthlyBills(husband.database, husband.ws, TODAY)).filter((x) => ids.includes(x.id)).map((x) => x.paymentId)).toEqual([onHis, onHis, onHis]);
    expect(await skipsOf(husband.database)).toEqual([]);

    await voidTransaction(husband.database, husband.ws, onHis!);
    await home.settle();
    expect((await paidOf(wife, ids)).map((x) => x!.state === 'paid')).toEqual([false, false, false]);
    expect((await wife.database.db.values(sql`SELECT status FROM transactions WHERE id = ${payment}`))[0]).toEqual(['void']);
  });

  it('a Split part linked to a second bill on one phone links it on the other', async () => {
    const { home, wife, husband, card, b } = await household(BUILD);
    const all = await listAccounts(wife.database, wife.ws);
    const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
    await postTransaction(wife.database, wife.ws, {
      occurredOn: TODAY,
      description: 'Tokopedia',
      lines: splitExpenseLines({
        paymentAccountId: card,
        currency: 'IDR',
        splits: [
          { categoryAccountId: category('utilities.internet_provider'), amountMinor: 385_000 },
          { categoryAccountId: category('utilities.mobile_phone'), amountMinor: 150_000 },
        ],
      }),
      billLinks: [{ templateId: b.internet, billMonth: '2026-11' }, { templateId: b.phone, billMonth: '2026-11' }],
    });
    await home.settle();
    const his = await paidOf(husband, [b.internet, b.phone, b.phone2]);
    expect(his.slice(0, 2)).toEqual(PAID.slice(0, 2));
    expect(his[2]!.state).not.toBe('paid');
  });

  it('while the other phone is on an older build the list is held — it reads the first bill paid — and goes once it updates', async () => {
    const { home, wife, husband, card, b } = await household(OLDER);
    await recordBillsAsOnePayment(wife.database, wife.ws, { paidOn: TODAY, moneyAccountId: card, payments: payments(b) });
    await home.settle();
    const ids = [b.internet, b.phone, b.phone2];
    const logged = (await wife.database.db.values<[string]>(sql`SELECT entry_json FROM sync_outbox`)).map(([json]) => json).join('');
    expect(logged).not.toContain('severalBills');
    expect((await paidOf(husband, ids)).map((x) => x!.state === 'paid')).toEqual([true, false, false]);
    expect((await runSharedBookRepairs(wife.database, home.bookId, { today: TODAY })).severalBills).toBeNull();

    // He updates: his next sync says the new build.
    husband.engine = new SyncEngine(husband.database, husband.transport, husband.keys, undefined, { appVersion: BUILD, shareRecords: husband.records });
    await home.settle();
    expect((await runSharedBookRepairs(wife.database, home.bookId, { today: TODAY })).severalBills).toBe(1);
    await home.settle();
    expect(await paidOf(husband, ids)).toEqual(PAID);
    // Once for his crossing.
    expect((await runSharedBookRepairs(wife.database, home.bookId, { today: TODAY })).severalBills).toBeNull();
    expect(await skipsOf(husband.database)).toEqual([]);
  });
});
