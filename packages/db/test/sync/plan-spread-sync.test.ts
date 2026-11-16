import { addMonths, monthPeriod } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  categoryTotalsIn,
  createAccount,
  createBook,
  inBook,
  instalmentSpendingIn,
  listInstallments,
  migrate,
  periodFlows,
  personalBook,
  runSharedBookRepairs,
  saveCardTerms,
  saveInstallment,
  setBookMonthStart,
  setInstallmentCountMode,
  updateInstallment,
} from '../../src/index';
import { SyncEngine } from '../../src/sync/engine';
import { categoryOf, type Device, Household, skipsOf } from './household';

/*
 * A card instalment plan with no purchase, counted Each month in a Family category (0123, design
 * docs/sdd/card-instalments-c-no-purchase-family.md option a). Invented, after the owner's TF 136 plan: 24 ×
 * Rp 1.000.000 first billed February 2025, statement day the 13th, the card kept since its opening balance on
 * 1 Sep 2026 — so instalments 20–24 (Sep 2026 – Jan 2027) are the app's. Fandri's plan; Dewi shares Family.
 */

const BUILD = '0.5.6';
const OLDER = '0.5.5';
const MONTHS = Array.from({ length: 8 }, (_, i) => addMonths('2026-07', i)); // Jul 2026 – Feb 2027

async function asOlderSchema(d: Device) {
  await d.database.execScript(`DROP TABLE plan_spreads; DELETE FROM schema_migrations WHERE version = 123;`);
}

async function update(d: Device) {
  expect(await migrate(d.database)).toEqual([123]);
  d.engine = new SyncEngine(d.database, d.transport, d.keys, undefined, { appVersion: BUILD, shareRecords: d.records });
}

async function household(options: { dewi?: string } = {}) {
  const home = new Household();
  const fandri = await home.device('Fandri', undefined, 'IDR', BUILD, { phoneErrors: true });
  const dewi = await home.device('Dewi', undefined, 'IDR', options.dewi ?? BUILD, { phoneErrors: true });
  if ((options.dewi ?? BUILD) === OLDER) await asOlderSchema(dewi);
  const personal = (await personalBook(fandri.database, fandri.ws)).id;
  const family = await createBook(fandri.database, fandri.ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const card = await createAccount(fandri.database, fandri.ws, { name: 'Visa Kencana', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 8_000_000, openedOn: '2026-09-01' });
  await saveCardTerms(fandri.database, fandri.ws, { accountId: card.id, statementDay: 13, dueDay: 2, creditLimitMinor: null, annualFeeMinor: null });
  const electronics = await categoryOf(fandri.database, family, 'Electronics');
  const { relayBookId } = await fandri.engine.shareBook(family, { memberId: fandri.memberId, memberName: 'Fandri', deviceName: 'Fandri’s phone' });
  home.bookId = family;
  home.relayBookId = relayBookId;
  await home.join(dewi, fandri);
  await home.settle();
  await fandri.database.execScript(`
    CREATE TEMP TABLE IF NOT EXISTS seen_outbox (entry_json TEXT NOT NULL);
    CREATE TEMP TRIGGER IF NOT EXISTS seen_outbox_ins AFTER INSERT ON main.sync_outbox BEGIN INSERT INTO seen_outbox (entry_json) VALUES (NEW.entry_json); END;`);
  const planId = await saveInstallment(fandri.database, fandri.ws, {
    cardAccountId: card.id,
    description: 'Phone',
    totalMinor: 24_000_000,
    months: 24,
    firstBilledMonth: '2025-02',
    countMode: 'each_month',
    categoryAccountId: electronics,
  });
  await home.settle();
  const fam = (d: Device) => inBook(d.ws, family);
  const sentPlanSpreads = async () =>
    (await fandri.database.db.values<[string]>(sql`SELECT entry_json FROM temp.seen_outbox`))
      .flatMap(([json]) => (JSON.parse(json) as { ops: { entity: string }[] }).ops)
      .filter((op) => op.entity === 'plan_spread');
  return { home, fandri, dewi, family, card: card.id, electronics, planId, fam, sentPlanSpreads };
}

type H = Awaited<ReturnType<typeof household>>;

/** Family's spending on one phone, month by month (debt payments are each phone's own, and not compared). */
async function familyFigures(h: H, d: Device, startDay = 1) {
  const out: Record<string, unknown> = {};
  for (const month of MONTHS) {
    const { from, to } = monthPeriod(month, startDay);
    out[month] = {
      cashflow: (await categoryTotalsIn(d.database, h.fam(d), 'expense', from, to, { billMonths: true })).rows.reduce((s, r) => s + r.amountBaseMinor, 0),
      flows: (await periodFlows(d.database, h.fam(d), { from, to })).byMonth.map((m) => [m.month, m.spendingMinor]),
    };
  }
  return out;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('a plan with no purchase in a Family category, on both phones', () => {
  it('counts each month from the card’s records start, the same on both phones, and nothing before', async () => {
    const h = await household();
    const mine = await familyFigures(h, h.fandri);
    expect(await familyFigures(h, h.dewi)).toEqual(mine);
    expect(mine['2026-08']).toMatchObject({ cashflow: 0 });
    expect(mine['2026-09']).toMatchObject({ cashflow: 1_000_000 });
    expect(mine['2026-11']).toMatchObject({ cashflow: 1_000_000 });
    expect(mine['2027-01']).toMatchObject({ cashflow: 1_000_000 });
    expect(mine['2027-02']).toMatchObject({ cashflow: 0 });
    expect(await skipsOf(h.dewi.database)).toEqual([]);
    // Her row cannot be opened: the plan is his.
    const nov = await instalmentSpendingIn(h.dewi.database, h.fam(h.dewi), '2026-11-01', '2026-11-30');
    expect(nov.lines).toEqual([expect.objectContaining({ statementOn: '2026-11-13', amountBaseMinor: 1_000_000, received: true, number: 22, of: 24 })]);
    // Neither phone counts it in Personal.
    const personal = inBook(h.fandri.ws, (await personalBook(h.fandri.database, h.fandri.ws)).id);
    expect((await categoryTotalsIn(h.fandri.database, personal, 'expense', '2026-11-01', '2026-11-30')).rows).toEqual([]);
  });

  it('when months start on the 25th', async () => {
    const h = await household();
    await setBookMonthStart(h.fandri.database, h.fandri.ws, h.family, 25);
    await h.home.settle();
    expect(await familyFigures(h, h.dewi, 25)).toEqual(await familyFigures(h, h.fandri, 25));
  });

  it('moved back to Personal, or At purchase, it leaves Family on both phones', async () => {
    const h = await household();
    const plan = (await listInstallments(h.fandri.database, h.fandri.ws))[0]!;
    await updateInstallment(h.fandri.database, h.fandri.ws, {
      id: plan.id,
      description: plan.description,
      totalMinor: plan.totalMinor,
      months: plan.months,
      firstBilledMonth: plan.firstBilledMonth,
      earnsPoints: plan.earnsPoints,
      categoryAccountId: null,
    });
    await h.home.settle();
    expect((await familyFigures(h, h.dewi))['2026-11']).toMatchObject({ cashflow: 0 });
    expect(await h.dewi.database.db.values(sql`SELECT id FROM plan_spreads`)).toEqual([]);
    expect(await familyFigures(h, h.dewi)).toEqual(await familyFigures(h, h.fandri));

    const again = await household();
    await setInstallmentCountMode(again.fandri.database, again.fandri.ws, again.planId, 'at_purchase');
    await again.home.settle();
    expect(await again.dewi.database.db.values(sql`SELECT id FROM plan_spreads`)).toEqual([]);
    expect(await familyFigures(again, again.dewi)).toEqual(await familyFigures(again, again.fandri));
  });
});

describe('while her phone is on 0.5.5', () => {
  it('nothing goes into the log, her sync goes on; once she updates, R9 sends it and the phones agree', async () => {
    const h = await household({ dewi: OLDER });
    expect(await h.sentPlanSpreads()).toEqual([]);
    expect(await skipsOf(h.dewi.database)).toEqual([]);
    expect((await familyFigures(h, h.dewi))['2026-11']).toMatchObject({ cashflow: 0 });
    expect((await runSharedBookRepairs(h.fandri.database, h.family)).planSpreads).toBeNull();

    await update(h.dewi);
    await h.home.settle();
    expect((await runSharedBookRepairs(h.fandri.database, h.family)).planSpreads).toBe(1);
    await h.home.settle();
    expect(await familyFigures(h, h.dewi)).toEqual(await familyFigures(h, h.fandri));
    expect(await skipsOf(h.dewi.database)).toEqual([]);
    // Once per crossing; a later change goes at once.
    expect((await runSharedBookRepairs(h.fandri.database, h.family)).planSpreads).toBeNull();
    await tick();
    await setInstallmentCountMode(h.fandri.database, h.fandri.ws, h.planId, 'at_purchase');
    await h.home.settle();
    expect((await familyFigures(h, h.dewi))['2026-11']).toMatchObject({ cashflow: 0 });
  });

  it('a phone on 0.5.5 that joins later is held from as well: its join goes through', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri', undefined, 'IDR', BUILD, { phoneErrors: true });
    const personal = (await personalBook(fandri.database, fandri.ws)).id;
    const family = await createBook(fandri.database, fandri.ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal });
    const card = await createAccount(fandri.database, fandri.ws, { name: 'Visa Kencana', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 8_000_000, openedOn: '2026-09-01' });
    const electronics = await categoryOf(fandri.database, family, 'Electronics');
    await saveInstallment(fandri.database, fandri.ws, { cardAccountId: card.id, description: 'Phone', totalMinor: 24_000_000, months: 24, firstBilledMonth: '2025-02', countMode: 'each_month', categoryAccountId: electronics });
    const { relayBookId } = await fandri.engine.shareBook(family, { memberId: fandri.memberId, memberName: 'Fandri', deviceName: 'Fandri’s phone' });
    home.bookId = family;
    home.relayBookId = relayBookId;
    const dewi = await home.device('Dewi', undefined, 'IDR', OLDER, { phoneErrors: true });
    await asOlderSchema(dewi);
    await home.join(dewi, fandri);
    await home.settle();
    expect(await skipsOf(dewi.database)).toEqual([]);
    // A phone on this build joining after it gets the plan once R9 runs.
    await update(dewi);
    await home.settle();
    expect((await runSharedBookRepairs(fandri.database, family)).planSpreads).toBe(1);
    await home.settle();
    expect(await dewi.database.db.values(sql`SELECT description FROM plan_spreads`)).toEqual([['Phone']]);
  });
});
