import { addMonths, monthPeriod, splitExpenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  autoLinkInstalmentPlans,
  budgetSheetFor,
  categoryTotalsIn,
  createAccount,
  createBook,
  createCardAccount,
  dailyTotalsIn,
  essentialSplitIn,
  inBook,
  instalmentSpendingIn,
  migrate,
  periodFlows,
  personalBook,
  postTransaction,
  replaceTransaction,
  runSharedBookRepairs,
  saveCardTerms,
  saveInstallment,
  setBookMonthStart,
  setInstallmentCountMode,
} from '../../src/index';
import { captureConfigOf, writeChangeSetsTx } from '../../src/sync/capture';
import { SyncEngine } from '../../src/sync/engine';
import { categoryOf, type Device, headOf, Household, projectBook, skipsOf } from './household';

/*
 * Card instalments C in a shared workspace (docs/sdd/card-instalments-c-sync.md). Invented: Fandri buys a laptop on his
 * card on 10 Nov 2026 for Rp 12.000.000, split Rp 8.000.000 Family (shared with Dewi) and Rp 4.000.000 Business (his
 * own), and turns it into 12 × Rp 1.000.000 from December, statement day the 18th. His plan counts Each month; Dewi's
 * phone must count Family's part the same way, to the same rupiah, every month.
 */

const BUILD = '0.5.5';
const OLDER = '0.5.4';
const FAMILY_PART = 8_000_000;
const PRIVATE_PART = 4_000_000;
const MONTHS = Array.from({ length: 13 }, (_, i) => addMonths('2026-11', i)); // Nov 2026 – Nov 2027

/** Her database as a 0.5.4 build holds it: no 0121, so no table for a spread. */
async function asOlderSchema(d: Device) {
  await d.database.execScript(`DROP TABLE purchase_spreads; DELETE FROM schema_migrations WHERE version = 121;`);
}

/** She updates: 0121 runs, and the engine says this build on its next sync. */
async function update(d: Device) {
  expect(await migrate(d.database)).toEqual([121]);
  d.engine = new SyncEngine(d.database, d.transport, d.keys, undefined, { appVersion: BUILD, shareRecords: d.records });
}

async function household(options: { dewi?: string; olderSchema?: boolean; excluded?: boolean; asOldSheet?: boolean } = {}) {
  const home = new Household();
  const fandri = await home.device('Fandri', undefined, 'IDR', BUILD, { phoneErrors: true });
  const dewi = await home.device('Dewi', undefined, 'IDR', options.dewi ?? BUILD, { phoneErrors: true });
  if (options.olderSchema ?? (options.dewi ?? BUILD) === OLDER) await asOlderSchema(dewi);
  const personal = (await personalBook(fandri.database, fandri.ws)).id;
  const family = await createBook(fandri.database, fandri.ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const business = await createBook(fandri.database, fandri.ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const card = (await createCardAccount(fandri.database, fandri.ws, { name: 'Visa Kencana', subtype: 'credit_card', currency: 'IDR', last4: '4417' })).id;
  await saveCardTerms(fandri.database, fandri.ws, { accountId: card, statementDay: 18, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
  const electronics = await categoryOf(fandri.database, family, 'Electronics');
  const office = (await createAccount(fandri.database, inBook(fandri.ws, business), { name: 'Office supplies', kind: 'expense', subtype: 'category', currency: null })).id;
  const { relayBookId } = await fandri.engine.shareBook(family, { memberId: fandri.memberId, memberName: 'Fandri', deviceName: 'Fandri’s phone' });
  home.bookId = family;
  home.relayBookId = relayBookId;
  await home.join(dewi, fandri);
  await home.settle();
  // Every change-set his phone writes from here, drained or not.
  await fandri.database.execScript(`
    CREATE TEMP TABLE IF NOT EXISTS seen_outbox (entry_json TEXT NOT NULL);
    CREATE TEMP TRIGGER IF NOT EXISTS seen_outbox_ins AFTER INSERT ON main.sync_outbox BEGIN INSERT INTO seen_outbox (entry_json) VALUES (NEW.entry_json); END;`);
  const laptopLines = splitExpenseLines({
    paymentAccountId: card,
    currency: 'IDR',
    splits: [
      { categoryAccountId: electronics, amountMinor: FAMILY_PART },
      { categoryAccountId: office, amountMinor: PRIVATE_PART },
    ],
  });
  const purchase = await postTransaction(fandri.database, inBook(fandri.ws, family), {
    occurredOn: '2026-11-10',
    description: 'Laptop',
    lines: laptopLines,
    acrossBooks: true,
    ...(options.excluded ? { excludedFromReport: true } : {}),
  });
  await home.settle();
  const [lineage] = (await fandri.database.db.values<[string]>(sql`SELECT lineage_id FROM sync_lineage WHERE head_transaction_id = ${purchase}`))[0]!;
  // The old sheet never named the purchase, and 0120 left such a plan At purchase.
  const planId = options.asOldSheet
    ? await saveInstallment(fandri.database, fandri.ws, { cardAccountId: card, description: 'Laptop', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-12', countMode: 'at_purchase' })
    : await saveInstallment(fandri.database, fandri.ws, { cardAccountId: card, description: 'Laptop', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-12', transactionId: purchase });
  await home.settle();
  const fam = (d: Device) => inBook(d.ws, family);
  /** Every op his phone has put in the book's log since the join, drained or not. */
  const logged = async (d: Device) => {
    const rows = await d.database.db.values<[string]>(sql`SELECT entry_json FROM temp.seen_outbox`);
    return rows.flatMap(([json]) => (JSON.parse(json) as { ops: { entity: string; id: string; fields?: Record<string, unknown> }[] }).ops);
  };
  return { home, fandri, dewi, family, business, card, electronics, office, purchase, lineage, planId, laptopLines, fam, logged };
}

type H = Awaited<ReturnType<typeof household>>;

/** Family's figures on one phone, month by month, read through every page's reader. */
async function familyFigures(h: H, d: Device, startDay = 1) {
  const ws = h.fam(d);
  const out: Record<string, unknown> = {};
  for (const month of MONTHS) {
    const { from, to } = monthPeriod(month, startDay);
    const total = (rows: { amountBaseMinor: number }[]) => rows.reduce((sum, row) => sum + row.amountBaseMinor, 0);
    const flows = await periodFlows(d.database, ws, { from, to });
    const sheet = await budgetSheetFor(d.database, ws, month);
    const split = await essentialSplitIn(d.database, ws, from, to, { excludeEvents: true });
    out[month] = {
      cashflow: total((await categoryTotalsIn(d.database, ws, 'expense', from, to, { billMonths: true })).rows),
      days: (await dailyTotalsIn(d.database, ws, 'expense', from, to, { billMonths: true })).days,
      // Spending only: debt payments are a fact about one's own accounts (flows.ts), and the card is his alone.
      flows: flows.byMonth.map((m) => [m.month, m.spendingMinor]),
      budget: sheet.spendingActualMinor,
      split: split.split.spendingMinor,
    };
  }
  return out;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const spreadOps = (ops: { entity: string; fields?: Record<string, unknown> }[]) => ops.filter((op) => op.entity === 'purchase' && op.fields && 'spread' in op.fields);

describe('two phones agree on an Each month plan in Family', () => {
  it('every month from Nov 2026 to Nov 2027, on every page, with the purchase split 8jt Family / 4jt Business', async () => {
    const h = await household();
    const mine = await familyFigures(h, h.fandri);
    expect(await familyFigures(h, h.dewi)).toEqual(mine);
    // And the figures are the spread ones: nothing in November, two thirds of each instalment from December.
    expect(mine['2026-11']).toMatchObject({ cashflow: 0, budget: 0, split: 0 });
    expect(mine['2026-12']).toMatchObject({ cashflow: 666_667, days: [{ date: '2026-12-18', amountMinor: 666_667 }], budget: 666_667 });
    const sum = MONTHS.reduce((s, month) => s + ((mine[month] as { cashflow: number }).cashflow), 0);
    expect(Math.abs(sum - FAMILY_PART)).toBeLessThanOrEqual(12);
    expect(await projectBook(h.dewi.database, h.family)).toEqual(await projectBook(h.fandri.database, h.family));
    expect(await skipsOf(h.dewi.database)).toEqual([]);
    // Her list draws the instalment as a row, which she cannot open: the plan is his.
    const dec = await instalmentSpendingIn(h.dewi.database, h.fam(h.dewi), '2026-12-01', '2026-12-31');
    expect(dec.lines).toEqual([expect.objectContaining({ statementOn: '2026-12-18', amountBaseMinor: 666_667, received: true, number: 1, of: 12 })]);
    expect(Object.values(dec.spreadMonths)).toEqual([12]);
  });

  it('when months start on the 25th', async () => {
    const h = await household();
    await setBookMonthStart(h.fandri.database, h.fandri.ws, h.family, 25);
    await h.home.settle();
    expect(await familyFigures(h, h.dewi, 25)).toEqual(await familyFigures(h, h.fandri, 25));
  });

  it('when the purchase is excluded from the report: nothing counts on either phone', async () => {
    const h = await household({ excluded: true });
    const mine = await familyFigures(h, h.fandri);
    expect(await familyFigures(h, h.dewi)).toEqual(mine);
    for (const month of MONTHS) expect((mine[month] as { cashflow: number }).cashflow).toBe(0);
  });

  it('when the plan goes back to At purchase, both count the part whole in November again', async () => {
    const h = await household();
    await setInstallmentCountMode(h.fandri.database, h.fandri.ws, h.planId, 'at_purchase');
    await h.home.settle();
    const mine = await familyFigures(h, h.fandri);
    expect(await familyFigures(h, h.dewi)).toEqual(mine);
    expect(mine['2026-11']).toMatchObject({ cashflow: FAMILY_PART });
    expect(await h.dewi.database.db.values(sql`SELECT * FROM purchase_spreads`)).toEqual([]);
  });

  it('when his statement day moves to the 25th, her instalments move with it', async () => {
    const h = await household();
    await saveCardTerms(h.fandri.database, h.fandri.ws, { accountId: h.card, statementDay: 25, dueDay: 10, creditLimitMinor: null, annualFeeMinor: null });
    await h.home.settle();
    const days = await dailyTotalsIn(h.dewi.database, h.fam(h.dewi), 'expense', '2026-12-01', '2026-12-31', { billMonths: true });
    expect(days.days).toEqual([{ date: '2026-12-25', amountMinor: 666_667 }]);
    expect(await familyFigures(h, h.dewi)).toEqual(await familyFigures(h, h.fandri));
  });
});

describe('a plan saved by the old sheet, tied to its purchase on opening the app', () => {
  it('goes out with its spread, and both phones count it each month alike', async () => {
    const h = await household({ asOldSheet: true });
    // Before: both count Family's part whole in November.
    expect((await familyFigures(h, h.dewi))['2026-11']).toMatchObject({ cashflow: FAMILY_PART });
    expect(await autoLinkInstalmentPlans(h.fandri.database, h.fandri.ws)).toEqual({ linked: 1, beforeRecords: 0, left: 0 });
    await h.home.settle();
    const mine = await familyFigures(h, h.fandri);
    expect(mine['2026-12']).toMatchObject({ cashflow: 666_667 });
    expect(await familyFigures(h, h.dewi)).toEqual(mine);
    expect(await skipsOf(h.dewi.database)).toEqual([]);
  });
});

describe('what goes and how it is taken', () => {
  it('the purchase op says its spread; a later edit on her phone keeps it', async () => {
    const h = await household();
    const [op] = spreadOps(await h.logged(h.fandri));
    expect(op!.fields!.spread).toEqual({ months: 12, firstBilledMonth: '2026-12', totalMinor: 12_000_000, monthlyMinor: 1_000_000, statementDay: 18, wholeBaseMinor: 12_000_000 });
    // Taken in place: her copy of the purchase is the same row it was before the spread came.
    const head = await headOf(h.dewi.database, h.lineage);
    expect(await h.dewi.database.db.values(sql`SELECT transaction_id, months FROM purchase_spreads`)).toEqual([[head, 12]]);
    // She edits her copy's note: reposted, the spread follows it to the new row.
    const [row] = await h.dewi.database.db.values<[string, number]>(sql`
      SELECT e.account_id, e.amount_minor FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${head} AND a.kind = 'expense'`);
    const [money] = await h.dewi.database.db.values<[string, number]>(sql`
      SELECT e.account_id, e.amount_minor FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${head} AND a.kind <> 'expense'`);
    await replaceTransaction(h.dewi.database, h.fam(h.dewi), head!, {
      occurredOn: '2026-11-10',
      description: 'Laptop kantor',
      lines: [
        { accountId: row![0], amountMinor: Number(row![1]), currency: 'IDR' },
        { accountId: money![0], amountMinor: Number(money![1]), currency: 'IDR' },
      ],
    });
    await h.home.settle();
    const after = await headOf(h.dewi.database, h.lineage);
    expect(after).not.toBe(head);
    expect(await h.dewi.database.db.values(sql`SELECT transaction_id FROM purchase_spreads`)).toEqual([[after]]);
    expect(await familyFigures(h, h.dewi)).toEqual(await familyFigures(h, h.fandri));
  });

  it('a spread from anyone but the payer is passed over', async () => {
    const h = await household();
    // A spread Dewi's phone puts in the log for his purchase: she has no plan of it, so it is not hers to say.
    await h.dewi.database.transaction(async (tx) => {
      const [book] = await tx.values<[string, number]>(sql`SELECT member_id, epoch FROM shared_books WHERE book_id = ${h.family}`);
      await writeChangeSetsTx(tx, captureConfigOf(h.dewi.database), { bookId: h.family, memberId: book![0], epoch: Number(book![1]) }, [
        { entity: 'purchase', id: h.lineage, op: 'upsert', fields: { spread: { months: 3, firstBilledMonth: '2026-12', totalMinor: 12_000_000, monthlyMinor: 4_000_000, statementDay: 18, wholeBaseMinor: 12_000_000 } } },
      ]);
    });
    await h.home.settle();
    expect(await h.fandri.database.db.values(sql`SELECT * FROM purchase_spreads`)).toEqual([]);
    // His own plan stands; and her own phone keeps what came from him.
    expect(await familyFigures(h, h.dewi)).toEqual(await familyFigures(h, h.fandri));
    expect(await skipsOf(h.fandri.database)).toEqual([]);
  });
});

describe('while her phone is on 0.5.4', () => {
  it('no spread goes into the log; her sync goes on; once she updates it goes at the clock it was made at, and the phones agree', async () => {
    const h = await household({ dewi: OLDER });
    expect(spreadOps(await h.logged(h.fandri))).toEqual([]);
    expect(await skipsOf(h.dewi.database)).toEqual([]);
    // Until then her phone counts Family's part whole, on its day, as today.
    expect((await familyFigures(h, h.dewi))['2026-11']).toMatchObject({ cashflow: FAMILY_PART });
    expect((await runSharedBookRepairs(h.fandri.database, h.family)).instalmentSpreads).toBeNull();

    await update(h.dewi);
    await h.home.settle();
    expect((await runSharedBookRepairs(h.fandri.database, h.family)).instalmentSpreads).toBe(1);
    await h.home.settle();
    expect(await familyFigures(h, h.dewi)).toEqual(await familyFigures(h, h.fandri));
    expect(await skipsOf(h.dewi.database)).toEqual([]);
    // One pass for her crossing; a later change goes at once.
    expect((await runSharedBookRepairs(h.fandri.database, h.family)).instalmentSpreads).toBeNull();
    await tick();
    await setInstallmentCountMode(h.fandri.database, h.fandri.ws, h.planId, 'at_purchase');
    await h.home.settle();
    expect((await familyFigures(h, h.dewi))['2026-11']).toMatchObject({ cashflow: FAMILY_PART });
  });

  it('an op with a spread reaching a database without 0121 is not refused, and leaves the purchase as it was', async () => {
    // She says this build but her database lacks 0121: the one way a spread could reach a table-less phone.
    const h = await household({ olderSchema: true });
    const cursor = await h.dewi.database.db.values(sql`SELECT applied_seq FROM sync_cursor WHERE book_id = ${h.family}`);
    expect(cursor.length).toBe(1);
    expect(await skipsOf(h.dewi.database)).toEqual([]);
    // The purchase stands whole on its day: the field is simply not taken.
    expect((await familyFigures(h, h.dewi))['2026-11']).toMatchObject({ cashflow: FAMILY_PART });
    expect(await h.dewi.database.db.values(sql`SELECT field FROM sync_field_clocks WHERE entity = 'purchase' AND field = 'spread'`)).toEqual([['spread']]);
    // Once 0121 runs, the stale clock is gone, so the payer's next word on it is taken.
    expect(await migrate(h.dewi.database)).toEqual([121]);
    expect(await h.dewi.database.db.values(sql`SELECT field FROM sync_field_clocks WHERE entity = 'purchase' AND field = 'spread'`)).toEqual([]);
    await tick();
    await setInstallmentCountMode(h.fandri.database, h.fandri.ws, h.planId, 'at_purchase');
    await tick();
    await setInstallmentCountMode(h.fandri.database, h.fandri.ws, h.planId, 'each_month');
    await h.home.settle();
    expect(await familyFigures(h, h.dewi)).toEqual(await familyFigures(h, h.fandri));
  });
});
