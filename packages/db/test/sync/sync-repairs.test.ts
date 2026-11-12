import { expenseLines, refundLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  billOfPurchase,
  unlinkPurchaseFromBill,
  billsInMonth,
  categoryTotalsIn,
  createAccount,
  dismissRepairNotice,
  inBook,
  linkPurchaseToBill,
  listAccounts,
  listTransactions,
  ownerScope,
  postTransaction,
  recordSharedExpense,
  repairNotices,
  runSharedBookRepairs,
  saveEvent,
  saveExpenseTemplate,
  sharedEventView,
} from '../../src/index';
import { categoryOf, headOf, Household, projectBook, type Device } from './household';
import { outboxOps } from './sync-helpers';
import { SyncEngine } from '../../src/sync/engine';
import { captureConfigOf, writeChangeSetsTx } from '../../src/sync/capture';
import { Trip } from './trip';

/*
 * The one-time repairs of a shared book (sync gaps phase 2, R1 and R2), on two phones. Invented figures throughout.
 */

const TODAY = '2026-11-12';

describe('R1: bill links an older build never sent', () => {
  async function couple() {
    const home = new Household();
    const wife = await home.device('Wife');
    const husband = await home.device('Husband');
    const bookId = await home.share(wife);
    await home.join(husband, wife);
    await home.settle();
    const cat = (await listAccounts(wife.database, wife.ws)).find((a) => a.systemKey === 'utilities.internet_provider')!.id;
    const bill = await saveExpenseTemplate(wife.database, wife.ws, { name: 'Fibre', categoryAccountId: cat, moneyAccountId: wife.bank, amountMinor: 410_000, dayOfMonth: 10, startsMonth: '2026-03' });
    await home.settle();
    const buy = (d: Device, category: string, occurredOn: string, description: string) =>
      postTransaction(d.database, d.ws, { occurredOn, description, lines: [{ accountId: category, amountMinor: 410_000, currency: 'IDR' }, { accountId: d.bank, amountMinor: -410_000, currency: 'IDR' }] });
    return { home, wife, husband, bookId, cat, bill, buy };
  }

  /** A link as an older build wrote it: the row alone, nothing sent. */
  const oldLink = (d: Device, transactionId: string, templateId: string, billMonth: string) =>
    d.database.db.run(sql`INSERT INTO bill_payments (transaction_id, workspace_id, template_id, bill_month) VALUES (${transactionId}, ${d.ws.workspaceId}, ${templateId}, ${billMonth})`);

  it('sends each old link once; a link under the partner’s clock is his to send, and his newer link stands', async () => {
    const { home, wife, husband, bookId, cat, bill, buy } = await couple();
    const march = await buy(wife, cat, '2026-03-11', 'Fibre March');
    const october = await buy(wife, cat, '2026-10-11', 'Fibre October');
    const november = await buy(wife, cat, '2026-11-11', 'Fibre November');
    const changed = await buy(wife, cat, '2026-05-11', 'Fibre May');
    await home.settle();
    await oldLink(wife, march, bill, '2026-03');
    await oldLink(wife, october, bill, '2026-10');
    await oldLink(wife, changed, bill, '2026-04');
    // November is linked by this build, and reaches the husband as it is made.
    await linkPurchaseToBill(wife.database, wife.ws, { templateId: bill, billMonth: '2026-11', transactionId: november, today: TODAY });
    // The husband links his copy of May's purchase to May, after the wife's old link to April.
    await home.settle();
    await linkPurchaseToBill(husband.database, husband.ws, { templateId: bill, billMonth: '2026-05', transactionId: (await headOf(husband.database, changed))!, today: TODAY });
    await home.settle();
    const linkOn = async (d: Device, lineage: string) => billOfPurchase(d.database, d.ws, (await headOf(d.database, lineage))!);
    expect(await linkOn(husband, march)).toBeNull();
    expect(await linkOn(husband, november)).toMatchObject({ billMonth: '2026-11', linked: true });

    const sentBefore = (await outboxOps(wife.database)).length;
    const report = await runSharedBookRepairs(wife.database, bookId, { today: TODAY });
    expect(report.billLinks).toBeGreaterThanOrEqual(2);
    const sent = (await outboxOps(wife.database)).slice(sentBefore);
    expect(sent.map((op) => op.id)).toContain(march);
    expect(sent.map((op) => op.id)).toContain(october);
    // May's purchase: the husband's newer link already reached her phone under his clock — his to resend, never hers.
    expect(sent.map((op) => op.id)).not.toContain(changed);
    await home.settle();
    expect(await linkOn(husband, march)).toMatchObject({ templateId: bill, billMonth: '2026-03', linked: true });
    expect(await linkOn(husband, october)).toMatchObject({ billMonth: '2026-10', linked: true });
    expect(await linkOn(husband, november)).toMatchObject({ billMonth: '2026-11', linked: true });
    // The husband's later link stands on both phones (it replaced the wife's old one when it arrived).
    expect(await linkOn(husband, changed)).toMatchObject({ billMonth: '2026-05' });
    expect(await linkOn(wife, changed)).toMatchObject({ billMonth: '2026-05' });

    // Once only: run again, nothing more goes.
    const after = (await outboxOps(wife.database)).length;
    expect(await runSharedBookRepairs(wife.database, bookId, { today: TODAY })).toMatchObject({ billLinks: null, eventTags: null });
    expect((await outboxOps(wife.database)).length).toBe(after);
    // The husband's own run: he had no old link. A link made by this build before its first repair goes again (the
    // same value, so nothing changes on either phone); the wife's old April link is not his to send.
    await runSharedBookRepairs(husband.database, bookId, { today: TODAY });
    await home.settle();
    expect(await linkOn(wife, changed)).toMatchObject({ billMonth: '2026-05' });
    const purchases = async (d: Device) => (await projectBook(d.database, bookId)).purchase as Record<string, unknown>;
    const [w, h] = [await purchases(wife), await purchases(husband)];
    for (const id of [march, october, november]) expect(h[id]).toEqual(w[id]);
  });
});

describe('R1 through the rollout to 0.5.1 (fix rounds 3 and 4)', () => {
  async function couple(husbandVersion: string) {
    const home = new Household();
    const wife = await home.device('Wife', 'member-Wife', 'IDR', '0.5.1');
    const husband = await home.device('Husband', 'member-Husband', 'IDR', husbandVersion);
    const bookId = await home.share(wife);
    await home.join(husband, wife);
    await home.settle();
    const cat = (await listAccounts(wife.database, wife.ws)).find((a) => a.systemKey === 'utilities.internet_provider')!.id;
    const bill = await saveExpenseTemplate(wife.database, wife.ws, { name: 'Fibre', categoryAccountId: cat, moneyAccountId: wife.bank, amountMinor: 410_000, dayOfMonth: 10, startsMonth: '2026-03' });
    await home.settle();
    const buy = (occurredOn: string, description: string) =>
      postTransaction(wife.database, wife.ws, { occurredOn, description, lines: [{ accountId: cat, amountMinor: 410_000, currency: 'IDR' }, { accountId: wife.bank, amountMinor: -410_000, currency: 'IDR' }] });
    const march = await buy('2026-03-11', 'Fibre March');
    const april = await buy('2026-04-11', 'Fibre April');
    await home.settle();
    const linkOn = async (d: Device, lineage: string) => billOfPurchase(d.database, d.ws, (await headOf(d.database, lineage))!);
    /** A link a build before this one wrote on a phone and never sent: the row alone. */
    const localLink = async (d: Device, lineage: string, month: string) => {
      const head = (await headOf(d.database, lineage))!;
      await d.database.db.run(sql`DELETE FROM bill_payments WHERE transaction_id = ${head}`);
      await d.database.db.run(sql`INSERT INTO bill_payments (transaction_id, workspace_id, template_id, bill_month) VALUES (${head}, ${d.ws.workspaceId}, ${bill}, ${month})`);
    };
    const update = async (d: Device) => {
      d.engine = new SyncEngine(d.database, d.transport, d.keys, undefined, { appVersion: '0.5.1', shareRecords: d.records });
      await home.settle();
    };
    return { home, wife, husband, bookId, bill, cat, march, april, linkOn, localLink, update };
  }

  /** What builds 117 and 118 are left with after they apply a link or an unlink: the clock taken, the row not written. */
  const unwritten = async (d: Device, lineage: string, was: { templateId: string; billMonth: string } | null) => {
    const head = (await headOf(d.database, lineage))!;
    await d.database.db.run(sql`DELETE FROM bill_payments WHERE transaction_id = ${head}`);
    if (was) await d.database.db.run(sql`INSERT INTO bill_payments (transaction_id, workspace_id, template_id, bill_month) VALUES (${head}, ${d.ws.workspaceId}, ${was.templateId}, ${was.billMonth})`);
  };

  it('she updates, his 117 syncs, then he updates: her links land on his phone, paid once; one pass per device crossing', async () => {
    const { home, wife, husband, bookId, bill, march, april, linkOn, localLink, update } = await couple('0.5.0');
    await localLink(wife, march, '2026-03');
    await localLink(wife, april, '2026-04');
    const first = await runSharedBookRepairs(wife.database, bookId, { today: TODAY });
    expect(first.billLinks).toBe(2);
    expect(first.devicesBelow.map((d) => d.version)).toEqual(['0.5.0']);
    await home.settle();
    await unwritten(husband, march, null);
    await unwritten(husband, april, null);
    expect(await linkOn(husband, march)).toBeNull();
    // Nothing more while he is on 117, however often she opens the app.
    expect((await runSharedBookRepairs(wife.database, bookId, { today: TODAY })).billLinks).toBeNull();

    await update(husband);
    // His own pass sends none of hers: her clocks are hers to resend.
    expect((await runSharedBookRepairs(husband.database, bookId, { today: TODAY })).billLinks).toBe(0);
    const again = await runSharedBookRepairs(wife.database, bookId, { today: TODAY });
    expect(again).toMatchObject({ billLinks: 2, devicesBelow: [] });
    await home.settle();
    expect(await linkOn(husband, march)).toMatchObject({ templateId: bill, billMonth: '2026-03', linked: true });
    expect(await linkOn(husband, april)).toMatchObject({ billMonth: '2026-04', linked: true });
    for (const d of [wife, husband]) {
      const state = (await billsInMonth(d.database, d.ws, '2026-03', TODAY)).find((b) => b.bill.id === bill)?.state;
      expect([d.name, state]).toEqual([d.name, 'paid']);
    }
    // One pass for his crossing: none on any later launch.
    expect((await runSharedBookRepairs(wife.database, bookId, { today: TODAY })).billLinks).toBeNull();
    expect(await projectBook(husband.database, bookId)).toEqual(await projectBook(wife.database, bookId));
  });

  it('a stale device that never updates holds nothing up; his offline unlink is not overturned by her pass', async () => {
    const { home, wife, husband, bookId, march, april, linkOn, localLink } = await couple('0.5.1');
    // A stale phone in the book, on 0.5.0, never syncing again.
    const stale = await home.device('Stale phone', 'member-Stale', 'IDR', '0.5.0');
    await home.join(stale, wife);
    const later = await home.device('Tablet', 'member-Tablet', 'IDR', '0.5.0');
    await home.join(later, wife);
    await home.settle();
    await localLink(wife, march, '2026-03');
    await localLink(wife, april, '2026-04');
    const first = await runSharedBookRepairs(wife.database, bookId, { today: TODAY });
    expect(first.billLinks).toBe(2);
    expect(first.devicesBelow.map((d) => d.name).sort()).toEqual(["Stale phone's phone", "Tablet's phone"].sort());
    await home.settle([wife, husband, later]);
    expect(await linkOn(husband, march)).toMatchObject({ billMonth: '2026-03' });
    // He takes March's link off, offline.
    await unlinkPurchaseFromBill(husband.database, husband.ws, { transactionId: (await headOf(husband.database, march))! });
    // The tablet updates; the stale phone never does. Her phone hears of the tablet and makes its one pass.
    later.engine = new SyncEngine(later.database, later.transport, later.keys, undefined, { appVersion: '0.5.1', shareRecords: later.records });
    await home.settle([wife, later]);
    const pass = await runSharedBookRepairs(wife.database, bookId, { today: TODAY });
    expect(pass.billLinks).toBe(2);
    expect(pass.devicesBelow.map((d) => d.name)).toEqual(["Stale phone's phone"]);
    expect((await runSharedBookRepairs(wife.database, bookId, { today: TODAY })).billLinks).toBeNull();
    await home.settle([wife, husband, later]);
    await home.settle([wife, husband, later]);
    for (const d of [wife, husband, later]) {
      expect([d.name, await linkOn(d, march)]).toEqual([d.name, null]);
      expect([d.name, (await linkOn(d, april))?.billMonth]).toEqual([d.name, '2026-04']);
    }
  });

  it('her deliberate link wins over an old local link his 118 phone kept on that purchase', async () => {
    const { home, wife, husband, bookId, bill, march, linkOn, localLink, update } = await couple('0.5.0');
    // His 118 phone had linked March to February once, never sent.
    await localLink(husband, march, '2026-02');
    await linkPurchaseToBill(wife.database, wife.ws, { templateId: bill, billMonth: '2026-03', transactionId: march, today: TODAY });
    await home.settle();
    // 118 took her clock and kept its own row.
    await unwritten(husband, march, { templateId: bill, billMonth: '2026-02' });
    await update(husband);
    // His pass does not send his old row: the clock on it is hers.
    expect((await runSharedBookRepairs(husband.database, bookId, { today: TODAY })).billLinks).toBe(0);
    await runSharedBookRepairs(wife.database, bookId, { today: TODAY });
    await home.settle();
    for (const d of [wife, husband]) expect([d.name, (await linkOn(d, march))?.billMonth]).toEqual([d.name, '2026-03']);
  });

  it('her phone restored as a new device resends her links at her old clocks, and they land on his phone (fix round 5)', async () => {
    const home = new Household();
    const husband = await home.device('Husband', 'member-Husband', 'IDR', '0.5.0');
    const wife = await home.device('Wife', 'member-Wife', 'IDR', '0.5.1');
    const bookId = await home.share(husband);
    await home.join(wife, husband);
    await home.settle();
    const cat = await categoryOf(wife.database, bookId, 'Groceries');
    const bill = await saveExpenseTemplate(wife.database, wife.ws, { name: 'Fibre', categoryAccountId: cat, moneyAccountId: wife.bank, amountMinor: 410_000, dayOfMonth: 10, startsMonth: '2026-03' });
    const march = await postTransaction(wife.database, wife.ws, { occurredOn: '2026-03-11', description: 'Fibre March', lines: [{ accountId: cat, amountMinor: 410_000, currency: 'IDR' }, { accountId: wife.bank, amountMinor: -410_000, currency: 'IDR' }] });
    await home.settle();
    await linkPurchaseToBill(wife.database, wife.ws, { templateId: bill, billMonth: '2026-03', transactionId: march, today: TODAY });
    await home.settle();
    // His 118 phone took her clock and wrote nothing.
    await unwritten(husband, march, null);
    // Her phone is restored from a backup: a new device of the same member, invited back by him.
    const restored = await home.restore(wife, await wife.database.exportBytes());
    await restored.engine.checkRestore();
    const { code } = await husband.engine.createInvite(bookId, { inviterName: 'Husband', sameMember: true, memberId: wife.memberId });
    await restored.engine.joinBook(code, { ws: restored.ws, memberName: 'Wife', deviceName: 'new phone' });
    await home.settle([restored, husband]);
    husband.engine = new SyncEngine(husband.database, husband.transport, husband.keys, undefined, { appVersion: '0.5.1', shareRecords: husband.records });
    await home.settle([restored, husband]);
    const linkOn = async (d: Device) => billOfPurchase(d.database, d.ws, (await headOf(d.database, march))!);
    expect(await linkOn(husband)).toBeNull();
    expect((await runSharedBookRepairs(restored.database, bookId, { today: TODAY })).billLinks).toBe(1);
    await home.settle([restored, husband]);
    for (const d of [restored, husband]) expect([d.name, (await linkOn(d))?.billMonth]).toEqual([d.name, '2026-03']);
  });

  it('her second device resends her links; the partner’s member never wins a tie with her clock (fix round 5)', async () => {
    const { home, wife, husband, bookId, bill, march, linkOn, update } = await couple('0.5.0');
    const second = await home.device('Wife', 'member-Wife', 'IDR', '0.5.1');
    const { code } = await wife.engine.createInvite(bookId, { inviterName: 'Wife', sameMember: true, memberId: wife.memberId });
    await second.engine.joinBook(code, { ws: second.ws, memberName: 'Wife', deviceName: 'Wife’s tablet', memberId: wife.memberId });
    await home.settle();
    await linkPurchaseToBill(wife.database, wife.ws, { templateId: bill, billMonth: '2026-03', transactionId: march, today: TODAY });
    await home.settle();
    await unwritten(husband, march, null);
    await update(husband);
    // Her tablet's own pass (her first phone makes none here) resends the link her first phone made.
    expect((await runSharedBookRepairs(second.database, bookId, { today: TODAY })).billLinks).toBe(1);
    await home.settle();
    expect((await linkOn(husband, march))?.billMonth).toBe('2026-03');

    // His phone sends February under her clock: her phones keep March.
    const [clock] = await husband.database.db.values<[string]>(sql`SELECT hlc FROM sync_field_clocks WHERE entity = 'purchase' AND id = ${march} AND field = 'billLink'`);
    const [row] = await husband.database.db.values<[number, string]>(sql`SELECT epoch, member_id FROM shared_books WHERE book_id = ${bookId}`);
    await husband.database.transaction((tx) =>
      writeChangeSetsTx(tx, captureConfigOf(husband.database), { bookId, memberId: row![1], epoch: Number(row![0]) }, [
        { entity: 'purchase', id: march, op: 'upsert', fields: { billLink: { templateId: bill, billMonth: '2026-02' } }, changed: [], clocks: { billLink: clock![0] } },
      ]),
    );
    await home.settle();
    for (const d of [wife, second]) expect([d.name, (await linkOn(d, march))?.billMonth]).toEqual([d.name, '2026-03']);
  });

  it('her unlink reaches his phone that still held the link', async () => {
    const { home, wife, husband, bookId, bill, march, linkOn, update } = await couple('0.5.0');
    await linkPurchaseToBill(wife.database, wife.ws, { templateId: bill, billMonth: '2026-03', transactionId: march, today: TODAY });
    await home.settle();
    await unlinkPurchaseFromBill(wife.database, wife.ws, { transactionId: march });
    await home.settle();
    // 118 took the unlink's clock and kept the link.
    await unwritten(husband, march, { templateId: bill, billMonth: '2026-03' });
    expect(await linkOn(husband, march)).toMatchObject({ billMonth: '2026-03' });
    await update(husband);
    expect((await runSharedBookRepairs(husband.database, bookId, { today: TODAY })).billLinks).toBe(0);
    await runSharedBookRepairs(wife.database, bookId, { today: TODAY });
    await home.settle();
    for (const d of [wife, husband]) expect([d.name, await linkOn(d, march)]).toEqual([d.name, null]);
  });
});

describe('R1 on a purchase the partner recorded (fix round 1, #2)', () => {
  it('her old link on his purchase reaches him, at a fresh clock over his creation default', async () => {
    const home = new Household();
    const wife = await home.device('Wife');
    const husband = await home.device('Husband');
    const bookId = await home.share(wife);
    await home.join(husband, wife);
    await home.settle();
    const cat = await categoryOf(wife.database, bookId, 'Groceries');
    const bill = await saveExpenseTemplate(wife.database, wife.ws, { name: 'Fibre', categoryAccountId: cat, moneyAccountId: wife.bank, amountMinor: 410_000, dayOfMonth: 10, startsMonth: '2026-03' });
    await home.settle();
    const hcat = await categoryOf(husband.database, bookId, 'Groceries');
    const his = await postTransaction(husband.database, husband.ws, {
      occurredOn: '2026-06-11', description: 'Fibre June', lines: [{ accountId: hcat, amountMinor: 410_000, currency: 'IDR' }, { accountId: husband.bank, amountMinor: -410_000, currency: 'IDR' }],
    });
    await home.settle();
    const copy = (await headOf(wife.database, his))!;
    // His purchase went with its billLink at the creation default, under his clock (fix round 5): no word on a link, so
    // her old link here goes at a fresh clock rather than wait for his.
    const clocks = await wife.database.db.values<[string, string]>(sql`
      SELECT field, hlc FROM sync_field_clocks WHERE entity = 'purchase' AND id = ${his} AND field IN ('bill', 'billLink') ORDER BY field`);
    expect(clocks.map(([, hlc]) => hlc)[0]).toBe(clocks.map(([, hlc]) => hlc)[1]);
    expect(clocks[0]![1]).toMatch(new RegExp(`-${husband.deviceId}$`));
    await wife.database.db.run(sql`INSERT INTO bill_payments (transaction_id, workspace_id, template_id, bill_month) VALUES (${copy}, ${wife.ws.workspaceId}, ${bill}, '2026-06')`);
    expect((await runSharedBookRepairs(wife.database, bookId, { today: TODAY })).billLinks).toBe(1);
    await home.settle();
    expect(await billOfPurchase(husband.database, husband.ws, (await headOf(husband.database, his))!)).toMatchObject({ templateId: bill, billMonth: '2026-06', linked: true });
    expect(await billOfPurchase(wife.database, wife.ws, copy)).toMatchObject({ billMonth: '2026-06', linked: true });
  });
});

describe('R2: Family purchases tagged to an event without being moved', () => {
  async function familyAndTrip() {
    const trip = new Trip();
    const wife = await trip.device('Wife');
    const husband = await trip.device('Husband');
    const home = trip.home;
    const family = await home.share(wife);
    await home.join(husband, wife);
    await home.settle();
    await trip.share(wife);
    await trip.join(husband, wife);
    await trip.settle([wife, husband]);
    const settle = async () => {
      await home.settle();
      await trip.settle([wife, husband]);
      await home.settle();
    };
    const person = async (d: Device) => (await d.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`))[0]![0];
    return { trip, home, wife, husband, family, settle, wifePerson: await person(wife), husbandPerson: await person(husband) };
  }

  type Setup = Awaited<ReturnType<typeof familyAndTrip>>;

  async function familyOctober(s: Setup, d: Device) {
    const ws = inBook(d.ws, s.family);
    const { rows } = await categoryTotalsIn(d.database, ws, 'expense', '2026-10-01', '2026-10-31', { excludeEvents: true });
    const listed = (await listTransactions(d.database, ws, { from: '2026-10-01', to: '2026-10-31' })).filter((t) => !t.eventId);
    return { total: rows.reduce((sum, r) => sum + r.amountBaseMinor, 0), count: listed.length };
  }

  /** A tag as an older build wrote it: on this phone alone, nothing sent. */
  const oldTag = (d: Device, transactionId: string, eventId: string) => d.database.db.run(sql`UPDATE transactions SET event_id = ${eventId} WHERE id = ${transactionId}`);

  it('the wife’s two lira refunds move into the trip with the purchase’s split; both phones’ Family agree after', async () => {
    const s = await familyAndTrip();
    const { wife, husband } = s;
    const lira = await createAccount(wife.database, wife.ws, { name: 'Wife Lira', kind: 'asset', subtype: 'bank', currency: 'TRY' });
    const eventId = s.trip.eventOf(wife);
    await recordSharedExpense(wife.database, ownerScope(wife.ws), eventId, {
      occurredOn: '2026-10-07', amountMinor: 100_000, currency: 'TRY', rateToEvent: '1', payerPersonId: s.wifePerson,
      paidFrom: { accountId: lira.id, chargedMinor: null }, split: { mode: 'equal', people: [s.wifePerson, s.husbandPerson] }, categoryId: null, note: 'Yes Oto',
    });
    const groceries = await categoryOf(wife.database, s.family, 'Groceries');
    const refund = (amountMinor: number, occurredOn: string) =>
      postTransaction(wife.database, wife.ws, { occurredOn, description: 'Refund · Yes Oto', ratesToBase: { TRY: 560 }, lines: refundLines({ categoryAccountId: groceries, paymentAccountId: lira.id, amountMinor, currency: 'TRY' }) });
    const first = await refund(20_000, '2026-10-09');
    const second = await refund(10_000, '2026-10-10');
    await postTransaction(wife.database, wife.ws, { occurredOn: '2026-10-08', description: 'Dinner', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: wife.bank, amountMinor: 300_000, currency: 'IDR' }) });
    await s.settle();
    await oldTag(wife, first, eventId);
    await oldTag(wife, second, eventId);
    expect(await familyOctober(s, wife)).not.toEqual(await familyOctober(s, husband));

    // The husband's phone runs first: it moves nothing of hers (it holds no tag), and the refunds stay in Family.
    expect((await runSharedBookRepairs(husband.database, s.family, { today: TODAY })).eventTags).toEqual({ moved: 0, untagged: 0 });
    const report = await runSharedBookRepairs(wife.database, s.family, { today: TODAY });
    expect(report.eventTags).toEqual({ moved: 2, untagged: 0 });
    await s.settle();

    expect(await familyOctober(s, wife)).toEqual(await familyOctober(s, husband));
    expect(await familyOctober(s, wife)).toEqual({ total: 300_000, count: 1 });
    for (const d of [wife, husband]) {
      const view = (await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!;
      const refunds = view.expenses.filter((e) => e.amountMinor < 0).map((e) => [e.amountMinor, e.myShareMinor]).sort();
      expect(refunds).toEqual([[-20_000, -10_000], [-10_000, -5_000]].sort());
    }
    const [notice] = await repairNotices(wife.database);
    expect(notice!.rows.map((r) => [r.outcome, r.description, r.eventName])).toEqual([
      ['moved', 'Refund · Yes Oto', 'Coast week'],
      ['moved', 'Refund · Yes Oto', 'Coast week'],
    ]);
    expect(await repairNotices(husband.database)).toEqual([]);
    // Once only.
    expect(await runSharedBookRepairs(wife.database, s.family, { today: TODAY })).toMatchObject({ billLinks: null, eventTags: null });
    await dismissRepairNotice(wife.database, s.family);
    expect(await repairNotices(wife.database)).toEqual([]);
  });

  it('a refund matched only by its size, not by name, is not moved: untagged and listed (fix round 1, #4)', async () => {
    const s = await familyAndTrip();
    const { wife, husband } = s;
    const lira = await createAccount(wife.database, wife.ws, { name: 'Wife Lira', kind: 'asset', subtype: 'bank', currency: 'TRY' });
    const eventId = s.trip.eventOf(wife);
    await recordSharedExpense(wife.database, ownerScope(wife.ws), eventId, {
      occurredOn: '2026-10-07', amountMinor: 100_000, currency: 'TRY', rateToEvent: '1', payerPersonId: s.wifePerson,
      paidFrom: { accountId: lira.id, chargedMinor: null }, split: { mode: 'equal', people: [s.wifePerson, s.husbandPerson] }, categoryId: null, note: 'Boat',
    });
    const groceries = await categoryOf(wife.database, s.family, 'Groceries');
    const refund = await postTransaction(wife.database, wife.ws, {
      occurredOn: '2026-10-09', description: 'Refund · Kebab', ratesToBase: { TRY: 560 }, lines: refundLines({ categoryAccountId: groceries, paymentAccountId: lira.id, amountMinor: 20_000, currency: 'TRY' }),
    });
    await s.settle();
    await oldTag(wife, refund, eventId);
    expect((await runSharedBookRepairs(wife.database, s.family, { today: TODAY })).eventTags).toEqual({ moved: 0, untagged: 1 });
    const [notice] = await repairNotices(wife.database);
    expect(notice!.rows).toMatchObject([{ description: 'Refund · Kebab', outcome: 'untagged', why: 'It could not be matched to an expense in Coast week' }]);
    await s.settle();
    expect(await familyOctober(s, wife)).toEqual(await familyOctober(s, husband));
    const view = (await sharedEventView(husband.database, ownerScope(husband.ws), s.trip.eventOf(husband)))!;
    expect(view.expenses.map((e) => e.note)).toEqual(['Boat']);
  });

  it('a rate fetched for the day lets it move; with none to be had, a private event’s, or the partner’s, it is untagged and listed', async () => {
    const s = await familyAndTrip();
    const { wife, husband } = s;
    const eventId = s.trip.eventOf(wife);
    const groceries = await categoryOf(wife.database, s.family, 'Groceries');
    const yen = await createAccount(wife.database, wife.ws, { name: 'Wife Yen', kind: 'asset', subtype: 'cash', currency: 'JPY' });
    const inYen = await postTransaction(wife.database, wife.ws, {
      occurredOn: '2026-10-06', description: 'Snacks', ratesToBase: { JPY: 105 }, lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: yen.id, amountMinor: 1_000, currency: 'JPY' }),
    });
    const inDollars = await postTransaction(wife.database, wife.ws, {
      occurredOn: '2026-10-06', description: 'Duty free', ratesToBase: { USD: 16_000 }, lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: wife.usd, amountMinor: 2_500, currency: 'USD' }),
    });
    const party = await postTransaction(wife.database, wife.ws, { occurredOn: '2026-10-11', description: 'Party snacks', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: wife.bank, amountMinor: 80_000, currency: 'IDR' }) });
    const hisGroceries = await categoryOf(husband.database, s.family, 'Groceries');
    const his = await postTransaction(husband.database, husband.ws, { occurredOn: '2026-10-07', description: 'Fuel', lines: expenseLines({ categoryAccountId: hisGroceries, paymentAccountId: husband.bank, amountMinor: 90_000, currency: 'IDR' }) });
    await s.settle();
    const birthday = await saveEvent(wife.database, ownerScope(wife.ws), { name: 'Birthday', startsOn: '2026-10-01', endsOn: '2026-10-31' });
    await oldTag(wife, inYen, eventId);
    await oldTag(wife, inDollars, eventId);
    await oldTag(wife, party, birthday);
    await oldTag(wife, (await headOf(wife.database, his))!, eventId);

    const fetcher = async (from: string) => {
      if (from === 'JPY') return { rate: 105, sourceDate: '2026-10-06' };
      throw new Error('offline');
    };
    const report = await runSharedBookRepairs(wife.database, s.family, { today: TODAY, fetcher });
    expect(report.eventTags).toEqual({ moved: 1, untagged: 3 });
    const [notice] = await repairNotices(wife.database);
    const byName = Object.fromEntries(notice!.rows.map((r) => [r.description, r]));
    expect(byName['Snacks']).toMatchObject({ outcome: 'moved' });
    expect(byName['Duty free']).toMatchObject({ outcome: 'untagged', eventName: 'Coast week' });
    expect(byName['Duty free']!.why).toMatch(/rate/);
    expect(byName['Party snacks']).toMatchObject({ outcome: 'untagged', eventName: 'Birthday', why: null });
    expect(byName['Fuel']).toMatchObject({ outcome: 'untagged', why: 'Paid by Husband: moved from Husband’s phone' });
    await s.settle();
    expect(await familyOctober(s, wife)).toEqual(await familyOctober(s, husband));
    // The husband's purchase is his as it was, on his phone.
    expect(await headOf(husband.database, his)).toBe(his);
  });

  it('the same person’s two phones, both holding the tag, both repairing before either syncs: one expense in the event (fix round 1, #7)', async () => {
    const s = await familyAndTrip();
    const { wife, husband } = s;
    // Her second phone: the same member in Family, the same person in the trip.
    const second = await s.trip.device('Wife');
    const { code } = await wife.engine.createInvite(s.family, { inviterName: 'Wife', sameMember: true, memberId: wife.memberId });
    await second.engine.joinBook(code, { ws: second.ws, memberName: 'Wife', deviceName: 'Wife’s second phone', memberId: wife.memberId });
    const eventInvite = await wife.engine.createEventInvite(s.trip.bookId, { inviterName: 'Wife', forPersonId: s.wifePerson });
    const { eventId: secondEvent } = await second.engine.joinEvent(eventInvite.code, { ws: second.ws, personId: s.wifePerson, name: 'Wife', deviceName: 'Wife’s second phone' });
    const eventOf = (d: Device) => (d === second ? secondEvent : s.trip.eventOf(d));
    const all = [wife, husband, second];
    const settleAll = async () => {
      for (let i = 0; i < 3; i += 1) {
        await s.home.settle(all);
        await s.trip.settle(all);
      }
    };
    await settleAll();
    const groceries = await categoryOf(wife.database, s.family, 'Groceries');
    const kebab = await postTransaction(wife.database, wife.ws, { occurredOn: '2026-10-06', description: 'Kebab', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: wife.bank, amountMinor: 120_000, currency: 'IDR' }) });
    await settleAll();
    const eventId = s.trip.eventOf(wife);
    await oldTag(wife, kebab, eventId);
    await oldTag(second, (await headOf(second.database, kebab))!, secondEvent);
    const one = await runSharedBookRepairs(wife.database, s.family, { today: TODAY });
    const two = await runSharedBookRepairs(second.database, s.family, { today: TODAY });
    expect([one.eventTags, two.eventTags]).toEqual([{ moved: 1, untagged: 0 }, { moved: 1, untagged: 0 }]);
    await settleAll();
    for (const d of all) {
      const view = (await sharedEventView(d.database, ownerScope(d.ws), eventOf(d)))!;
      expect([d.name, view.expenses.map((e) => [e.note, e.amountMinor])]).toEqual([d.name, [['Kebab', 120_000]]]);
      expect(await headOf(d.database, kebab)).toBeNull();
    }
    expect(await familyOctober(s, wife)).toEqual(await familyOctober(s, husband));
  });

  it('the other phone of the same person, which has the event’s expense but not yet the void, leaves its row as it is and says so', async () => {
    const s = await familyAndTrip();
    const { wife, husband } = s;
    const second = await s.trip.device('Wife');
    const { code } = await wife.engine.createInvite(s.family, { inviterName: 'Wife', sameMember: true, memberId: wife.memberId });
    await second.engine.joinBook(code, { ws: second.ws, memberName: 'Wife', deviceName: 'Wife’s second phone', memberId: wife.memberId });
    const eventInvite = await wife.engine.createEventInvite(s.trip.bookId, { inviterName: 'Wife', forPersonId: s.wifePerson });
    const { eventId: secondEvent } = await second.engine.joinEvent(eventInvite.code, { ws: second.ws, personId: s.wifePerson, name: 'Wife', deviceName: 'Wife’s second phone' });
    const all = [wife, husband, second];
    const settleAll = async () => {
      for (let i = 0; i < 3; i += 1) {
        await s.home.settle(all);
        await s.trip.settle(all);
      }
    };
    await settleAll();
    const groceries = await categoryOf(wife.database, s.family, 'Groceries');
    const kebab = await postTransaction(wife.database, wife.ws, { occurredOn: '2026-10-06', description: 'Kebab', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: wife.bank, amountMinor: 120_000, currency: 'IDR' }) });
    await settleAll();
    await oldTag(wife, kebab, s.trip.eventOf(wife));
    const onSecond = (await headOf(second.database, kebab))!;
    await oldTag(second, onSecond, secondEvent);
    await runSharedBookRepairs(wife.database, s.family, { today: TODAY });
    // Only the trip syncs: the second phone hears of the expense, not yet of Family's void.
    await s.trip.settle(all);
    expect((await runSharedBookRepairs(second.database, s.family, { today: TODAY })).eventTags).toEqual({ moved: 0, untagged: 0 });
    expect(await second.database.db.values(sql`SELECT event_id, status FROM transactions WHERE id = ${onSecond}`)).toEqual([[secondEvent, 'posted']]);
    const [notice] = await repairNotices(second.database);
    expect(notice!.rows).toMatchObject([{ description: 'Kebab', outcome: 'elsewhere', why: 'Already moved into Coast week from another phone' }]);
    await settleAll();
    expect(await headOf(second.database, kebab)).toBeNull();
    const view = (await sharedEventView(second.database, ownerScope(second.ws), secondEvent))!;
    expect(view.expenses.map((e) => e.note)).toEqual(['Kebab']);
  });
});
