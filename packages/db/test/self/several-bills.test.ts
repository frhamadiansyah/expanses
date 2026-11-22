import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createCardAccount, listAccounts, monthlyBills, recordBillsAsOnePayment, saveExpenseTemplate, voidTransaction } from '../../src/index';
import { applySelfChangeSet, collectSelfChanges } from '../../src/self/channel';
import { encodeHlc } from '../../src/sync/hlc';
import { exchange, linkedPair, sameRows, type Device } from './devices';

vi.setConfig({ testTimeout: 60_000 });

/*
 * One payment, several bills (2026-11-22), between the owner's own devices (the self channel). Invented: three bills —
 * Internet Rp 385.000, Mobile phone Rp 150.000 and Mobile phone 2 Rp 100.000 — paid at once on Kartu Contoh 4417.
 */

const TODAY = '2026-11-22';

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

const PAID = [
  { state: 'paid', paidMinor: 385_000 },
  { state: 'paid', paidMinor: 150_000 },
  { state: 'paid', paidMinor: 100_000 },
];


describe('linked devices', () => {
  async function pair() {
    let bank = '';
    let card = '';
    const devices = await linkedPair(async ({ database, ws }) => {
      const all = await listAccounts(database, ws);
      bank = all.find((a) => a.kind === 'asset')?.id ?? '';
      card = (await createCardAccount(database, ws, { name: 'Kartu Contoh', subtype: 'credit_card', currency: 'IDR', last4: '4417' })).id;
    });
    const b = await threeBills(devices.phone, card || bank);
    await exchange(devices.phone, devices.mac);
    return { ...devices, card, b };
  }

  it('a payment of three bills goes to the other device whole, and its deletion takes all three back', async () => {
    const { phone, mac, card, b } = await pair();
    const [payment] = await recordBillsAsOnePayment(phone.database, phone.ws, { paidOn: TODAY, moneyAccountId: card, payments: payments(b) });
    await exchange(phone, mac);
    const ids = [b.internet, b.phone, b.phone2];
    expect(await paidOf(mac, ids)).toEqual(PAID);
    expect(await sameRows(phone, mac)).toEqual([]);
    await voidTransaction(mac.database, mac.ws, payment!);
    await exchange(mac, phone);
    expect((await paidOf(phone, ids)).map((x) => x!.state === 'paid')).toEqual([false, false, false]);
  });

  it('an older device’s one-part key for a bill link is read as the transaction’s one link', async () => {
    const { phone, mac, card, b } = await pair();
    const [payment] = await recordBillsAsOnePayment(phone.database, phone.ws, { paidOn: TODAY, moneyAccountId: card, payments: payments(b).slice(0, 2) });
    await exchange(phone, mac);
    await collectSelfChanges(mac.database, mac.deviceId);
    // An older build relinks the transaction to Mobile phone 2 alone: its row under the old key, made whole.
    const result = await applySelfChangeSet(
      mac.database,
      {
        v: 1,
        hlc: encodeHlc(Date.now() + 60_000, 0, 'c3'.repeat(16)),
        schema: 126,
        ops: [{ t: 'bill_payments', k: [payment], i: true, c: { workspace_id: mac.ws.workspaceId, template_id: b.phone2, bill_month: '2026-11' } }],
      },
      mac.deviceId,
    );
    expect(result.status).toBe('applied');
    expect(await mac.database.db.values(sql`SELECT template_id FROM bill_payments WHERE transaction_id = ${payment} ORDER BY template_id`)).toEqual([[b.phone2]]);
    // Its removal under the old key takes that one.
    await applySelfChangeSet(mac.database, { v: 1, hlc: encodeHlc(Date.now() + 120_000, 0, 'c3'.repeat(16)), schema: 126, ops: [{ t: 'bill_payments', k: [payment], d: true }] }, mac.deviceId);
    expect(await mac.database.db.values(sql`SELECT template_id FROM bill_payments WHERE transaction_id = ${payment}`)).toEqual([]);
  });
});
