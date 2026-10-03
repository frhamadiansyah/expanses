import { type CaptureLine, expenseLines, type StatementPeriod, transferLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CheckDecisions,
  type CheckDraftRow,
  cardStatement,
  categoryIdsByKey,
  createAccount,
  createBook,
  createCardAccount,
  createDraft,
  fillSameMerchant,
  getTrackPayments,
  inBook,
  listAccounts,
  listBooks,
  listDrafts,
  listStatementChecks,
  listStatementLinks,
  listTransactions,
  nativeBalances,
  ownerScope,
  postTransaction,
  prepareStatementCheck,
  recordStatementCheck,
  saveCardTerms,
  setTrackPayments,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/* Screenshot lines as Vision hands them over: a one-date layout, and the summary's balance labels. */
const line = (text: string, x: number, y: number, w = 0.2, h = 0.02): CaptureLine => ({ text, box: [x, y, w, h], height: h });
type Printed = [on: string, description: string, amount: string];
const image = (rows: Printed[], summary: { previous?: string; closing?: string } = {}): CaptureLine[] => {
  const out = rows.flatMap(([on, description, amount], i) => [line(on, 0.05, 0.1 + i * 0.05, 0.1), line(description, 0.25, 0.1 + i * 0.05, 0.5), line(amount, 0.85, 0.1 + i * 0.05, 0.12)]);
  let y = 0.1 + rows.length * 0.05 + 0.1;
  if (summary.previous) {
    out.push(line('Previous Balance', 0.05, y, 0.3), line(summary.previous, 0.85, y, 0.12));
    y += 0.05;
  }
  if (summary.closing) out.push(line('New Balance', 0.05, y, 0.3), line(summary.closing, 0.85, y, 0.12));
  return out;
};

const MAY: StatementPeriod = { start: '2026-05-11', end: '2026-06-10' };
const TODAY = '2026-07-01';
const NO_DECISIONS: CheckDecisions = { differs: {}, flagged: {}, ask: {}, moveStart: false };

async function household(opening: { openingBalanceMinor: number; openedOn: string } = { openingBalanceMinor: 0, openedOn: '2026-01-01' }) {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createCardAccount(database, ws, { name: 'Visa', subtype: 'credit_card', currency: 'IDR', ...opening });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 10, dueDay: 25, creditLimitMinor: null, annualFeeMinor: null });
  const other = await createCardAccount(database, ws, { name: 'Master', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-01-01' });
  const bank = await createAccount(database, ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const cat = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const groceries = cat('household.groceries');
  const books = cat('shopping.books');
  const fees = cat('miscellaneous.fees_charges');
  /** The balance-correction equity, made the first time a check needs it. */
  const correction = async () => (await listAccounts(database, ws)).find((a) => a.systemKey === 'balance_correction')!.id;
  const buy = (occurredOn: string, description: string, amountMinor: number, categoryAccountId = groceries, on = card.id) =>
    postTransaction(database, ws, { occurredOn, description, lines: expenseLines({ categoryAccountId, paymentAccountId: on, amountMinor, currency: 'IDR' }) });
  const balances = async () => nativeBalances(database, ws);
  const prepare = (images: CaptureLine[][], period = MAY, today = TODAY) => prepareStatementCheck(database, ws, { cardAccountId: card.id, period, images, today });
  const posted = async () => (await listTransactions(database, ws, { limit: 5000 })).length;
  const pay = (occurredOn: string, amountMinor: number) =>
    postTransaction(database, ws, { occurredOn, description: 'Pay the card', lines: transferLines({ fromAccountId: bank.id, toAccountId: card.id, amountMinor, currency: 'IDR' }) });
  return { database, ws, card, other, bank, groceries, books, fees, correction, buy, pay, balances, prepare, posted };
}

/** Every row given the category it needs. */
const categorised = (rows: CheckDraftRow[], categoryId: string) => rows.map((r) => (r.categoryId === null ? { ...r, categoryId, categorySource: 'owner' as const } : r));

describe('preparing a check', () => {
  it('matches what is recorded, finds what is missing, and fills known merchants and fees', async () => {
    const h = await household();
    await h.buy('2026-04-01', 'TOKO BUKU ANDALAS', 80_000, h.books);
    await h.buy('2026-05-15', 'KOPI SATU', 50_000);
    const prepared = await h.prepare([
      image([['15MAY', 'KOPI SATU', '50,000'], ['20MAY', 'TOKO BUKU ANDALAS', '120,000']]),
      image([['25MAY', 'BIAYA MATERAI', '10,000']], { closing: '260,000' }),
    ]);
    expect(prepared.rows.map((r) => r.outcome.status)).toEqual(['matched', 'missing', 'missing']);
    expect(prepared.rows[1]).toMatchObject({ categoryId: h.books, categorySource: 'known' });
    expect(prepared.rows[2]).toMatchObject({ isFee: true, categoryId: h.fees, categorySource: 'fee' });
    expect(prepared).toMatchObject({ closingMinor: 260_000, alreadyChecked: false, startsAfterPeriod: false, cardBalanceAtEndMinor: 130_000, flagged: [] });
  });
});

describe('fillSameMerchant', () => {
  it('fills every unanswered row of the same merchant and leaves another merchant alone', async () => {
    const h = await household();
    const prepared = await h.prepare([image([['12MAY', 'KEDAI ALFA JAKARTA ID', '10,000'], ['13MAY', 'KEDAI ALFA JAKARTA ID', '12,000'], ['14MAY', 'WARUNG BETA', '9,000']])]);
    const filled = fillSameMerchant(prepared.rows, 0, h.groceries);
    expect(filled.map((r) => [r.categoryId, r.categorySource])).toEqual([[h.groceries, 'owner'], [h.groceries, 'same-merchant'], [null, null]]);
    expect(prepared.rows[0]!.categoryId).toBeNull();
  });
});

describe('recording a check', () => {
  const statement = (closing: string) =>
    image(
      [['12MAY', 'TOKO ALFA', '100,000'], ['12MAY', 'KEDAI BETA', '200,000'], ['14MAY', 'TOKO ALFA', '30,000CR'], ['20MAY', 'PAYMENT THANK YOU', '50,000CR'], ['22MAY', 'PEMBAYARAN', '20,000CR']],
      { previous: '0', closing },
    );

  it('posts missing purchases and refunds, keeps untracked payments as one quiet line, and reconciles', async () => {
    const h = await household();
    const prepared = await h.prepare([statement('200,000')]);
    expect(prepared.rows.map((r) => r.outcome)).toMatchObject([
      { status: 'missing', as: 'purchase' },
      { status: 'missing', as: 'purchase' },
      { status: 'missing', as: 'refund' },
      { status: 'payment-untracked' },
      { status: 'payment-untracked' },
    ]);
    expect(prepared).toMatchObject({ untrackedPaymentsMinor: 70_000, untrackedPaymentsCount: 2 });
    const rows = categorised(fillSameMerchant(prepared.rows, 0, h.groceries), h.books);
    expect(rows[2]).toMatchObject({ categoryId: h.groceries, categorySource: 'same-merchant' });

    const result = await recordStatementCheck(h.database, h.ws, { ...prepared, rows }, NO_DECISIONS);
    expect(result).toMatchObject({ status: 'reconciled', differenceMinor: 0 });

    const balances = await h.balances();
    expect(balances[h.card.id]).toBe(-200_000);
    expect(balances[h.groceries]).toBe(70_000); // the refund took the purchase's category back down
    expect(balances[h.books]).toBe(200_000);

    const correction = await h.correction();
    const txs = await listTransactions(h.database, h.ws, { accountId: h.card.id });
    const adjustment = txs.filter((t) => t.description.startsWith('Payments not tracked'));
    expect(adjustment).toHaveLength(1);
    expect(adjustment[0]).toMatchObject({ description: 'Payments not tracked (2 payments)', excluded: true, occurredOn: MAY.end });
    expect(adjustment[0]!.entries.find((e) => e.accountId === correction)?.amountMinor).toBe(-70_000);

    const links = await listStatementLinks(h.database, result.checkId);
    expect(links.filter((l) => l.kind === 'recorded')).toHaveLength(3);
    expect(links.find((l) => l.kind === 'payments-untracked')?.transactionId).toBe(adjustment[0]!.id);
    expect(await listStatementChecks(h.database, h.ws, h.card.id)).toMatchObject([{ id: result.checkId, periodStart: MAY.start, periodEnd: MAY.end, closingMinor: 200_000, previousMinor: 0, status: 'reconciled' }]);
  });

  it('says by how much it differs when cicis closes elsewhere', async () => {
    const h = await household();
    const prepared = await h.prepare([statement('250,000')]);
    const rows = categorised(prepared.rows, h.groceries);
    expect(await recordStatementCheck(h.database, h.ws, { ...prepared, rows }, NO_DECISIONS)).toMatchObject({ status: 'differs', differenceMinor: 50_000 });
  });

  it('stays open without a summary to compare with', async () => {
    const h = await household();
    const open = await h.prepare([image([['12MAY', 'TOKO ALFA', '100,000']])]);
    expect(await recordStatementCheck(h.database, h.ws, { ...open, rows: categorised(open.rows, h.groceries) }, NO_DECISIONS)).toMatchObject({ status: 'open', differenceMinor: 0 });
  });

  it('refuses to record a missing row that has no category yet', async () => {
    const h = await household();
    const prepared = await h.prepare([image([['12MAY', 'TOKO ALFA', '100,000']])]);
    await expect(recordStatementCheck(h.database, h.ws, prepared, NO_DECISIONS)).rejects.toMatchObject({ code: 'NEEDS_CATEGORY' });
    expect(await h.posted()).toBe(0);
  });

  it('uses the statement amount only when asked, keeping the category and the note', async () => {
    const h = await household();
    const gamma = await h.buy('2026-05-15', 'KEDAI GAMMA', 100_000);
    const delta = await h.buy('2026-05-18', 'KEDAI DELTA', 50_000, h.books);
    const prepared = await h.prepare([image([['15MAY', 'KEDAI GAMMA', '102,000'], ['18MAY', 'KEDAI DELTA', '49,000']])]);
    expect(prepared.rows.map((r) => r.outcome)).toMatchObject([
      { status: 'differs', candidateId: gamma, statementMinor: 102_000, recordedMinor: 100_000 },
      { status: 'differs', candidateId: delta, statementMinor: 49_000, recordedMinor: 50_000 },
    ]);
    const result = await recordStatementCheck(h.database, h.ws, prepared, { ...NO_DECISIONS, differs: { 0: 'statement', 1: 'mine' } });

    const txs = await listTransactions(h.database, h.ws, { accountId: h.card.id, includeVoid: true });
    const replaced = txs.find((t) => t.description === 'KEDAI GAMMA' && t.status === 'posted')!;
    expect(replaced.id).not.toBe(gamma);
    expect(replaced.entries.find((e) => e.accountId === h.groceries)?.amountMinor).toBe(102_000);
    expect(txs.find((t) => t.id === gamma)?.status).toBe('void');
    expect(txs.find((t) => t.id === delta)?.status).toBe('posted');
    const links = await listStatementLinks(h.database, result.checkId);
    expect(links).toEqual(expect.arrayContaining([
      { checkId: result.checkId, transactionId: replaced.id, kind: 'differs-updated' },
      { checkId: result.checkId, transactionId: delta, kind: 'differs-kept' },
    ]));
  });

  it('deletes, moves or keeps what was recorded but is not on the statement', async () => {
    const h = await household();
    const a = await h.buy('2026-05-20', 'SALAH CATAT', 11_000);
    const b = await h.buy('2026-05-21', 'KARTU LAIN', 22_000);
    const c = await h.buy('2026-05-22', 'BELUM MASUK', 33_000);
    const prepared = await h.prepare([image([], { closing: '0' })]);
    expect(prepared.flagged.map((f) => f.transactionId)).toEqual([a, b, c]);
    expect(prepared.flagged[0]).toMatchObject({ on: '2026-05-20', description: 'SALAH CATAT', amountMinor: 11_000 });

    await recordStatementCheck(h.database, h.ws, prepared, { ...NO_DECISIONS, flagged: { [a]: 'delete', [b]: { moveTo: h.other.id }, [c]: 'keep' } });
    const txs = await listTransactions(h.database, h.ws, { includeVoid: true });
    expect(txs.find((t) => t.id === a)?.status).toBe('void');
    expect(txs.find((t) => t.id === b)?.status).toBe('void');
    expect(txs.find((t) => t.id === c)?.status).toBe('posted');
    const moved = txs.find((t) => t.description === 'KARTU LAIN' && t.status === 'posted')!;
    expect(moved.entries.find((e) => e.accountId === h.other.id)?.amountMinor).toBe(-22_000);
    expect((await h.balances())[h.card.id]).toBe(-33_000);
  });

  it('merges a matched draft by confirming it with the row’s category', async () => {
    const h = await household();
    const draftId = await createDraft(h.database, h.ws, { source: 'notification', occurredOn: '2026-05-16', description: 'KOPI DRAFT', amountMinor: 40_000, currency: 'IDR', kind: 'expense', accountId: h.card.id });
    const prepared = await h.prepare([image([['16MAY', 'KOPI DRAFT', '40,000']])]);
    expect(prepared.rows[0]!.outcome).toMatchObject({ status: 'matched', candidateIds: [`draft:${draftId}`] });
    const rows = categorised(prepared.rows, h.groceries);
    const result = await recordStatementCheck(h.database, h.ws, { ...prepared, rows }, NO_DECISIONS);
    expect(await listDrafts(h.database, h.ws)).toHaveLength(0);
    const [posted] = await listTransactions(h.database, h.ws, { accountId: h.card.id });
    expect(posted!.entries.find((e) => e.accountId === h.groceries)?.amountMinor).toBe(40_000);
    expect(await listStatementLinks(h.database, result.checkId)).toEqual([{ checkId: result.checkId, transactionId: posted!.id, kind: 'matched' }]);
  });

  it('links the transaction chosen for an ask, and keeps the tied one nobody chose', async () => {
    const h = await household();
    const first = await h.buy('2026-05-31', 'WARUNG', 55_000);
    const second = await h.buy('2026-05-31', 'WARUNG', 55_000);
    const prepared = await h.prepare([image([['31MAY', 'WARUNG', '55,000']])]);
    expect(prepared.rows[0]!.outcome).toMatchObject({ status: 'ask', candidateIds: [first, second] });
    const result = await recordStatementCheck(h.database, h.ws, prepared, { ...NO_DECISIONS, ask: { 0: second } });
    expect(await listStatementLinks(h.database, result.checkId)).toEqual([{ checkId: result.checkId, transactionId: second, kind: 'matched' }]);
    const txs = await listTransactions(h.database, h.ws, { accountId: h.card.id });
    expect(txs.map((t) => t.id).sort()).toEqual([first, second].sort());
  });

  it('deletes a tied transaction nobody chose when the decisions say so', async () => {
    const h = await household();
    const first = await h.buy('2026-05-31', 'WARUNG', 55_000);
    const second = await h.buy('2026-05-31', 'WARUNG', 55_000);
    const prepared = await h.prepare([image([['31MAY', 'WARUNG', '55,000']])]);
    await recordStatementCheck(h.database, h.ws, prepared, { ...NO_DECISIONS, ask: { 0: first }, flagged: { [second]: 'delete' } });
    const txs = await listTransactions(h.database, h.ws, { accountId: h.card.id });
    expect(txs.map((t) => t.id)).toEqual([first]);
  });

  it('a second check of a period posts nothing again', async () => {
    const h = await household();
    const images = [statement('200,000')];
    const prepared = await h.prepare(images);
    const first = await recordStatementCheck(h.database, h.ws, { ...prepared, rows: categorised(prepared.rows, h.groceries) }, NO_DECISIONS);
    const count = await h.posted();

    const again = await h.prepare(images);
    expect(again.alreadyChecked).toBe(true);
    expect(again.rows.every((r) => r.outcome.status === 'matched' || r.outcome.status === 'payment-untracked')).toBe(true);
    expect(again.flagged).toEqual([]);
    const second = await recordStatementCheck(h.database, h.ws, { ...again, rows: categorised(again.rows, h.groceries) }, NO_DECISIONS);
    expect(second.checkId).toBe(first.checkId);
    expect(second.status).toBe('reconciled');
    expect(await h.posted()).toBe(count);
    expect(await listStatementChecks(h.database, h.ws, h.card.id)).toHaveLength(1);
    expect((await h.balances())[h.card.id]).toBe(-200_000);
  });

  it('moving the card’s start keeps today’s balance', async () => {
    const h = await household({ openingBalanceMinor: 5_000_000, openedOn: '2026-08-01' });
    await h.buy('2026-08-15', 'SETELAH MULAI', 300_000);
    const today = '2026-09-01';
    const periods: [StatementPeriod, CaptureLine[][]][] = [
      [{ start: '2026-04-11', end: '2026-05-10' }, [image([['15APR', 'TOKO ALFA', '1,500,000'], ['25APR', 'PAYMENT THANK YOU', '500,000CR']], { previous: '1,000,000', closing: '2,000,000' })]],
      [{ start: '2026-05-11', end: '2026-06-10' }, [image([['15MAY', 'TOKO ALFA', '2,000,000']], { previous: '2,000,000', closing: '4,000,000' })]],
      [{ start: '2026-06-11', end: '2026-07-10' }, [image([['15JUN', 'TOKO ALFA', '1,500,000'], ['25JUN', 'PAYMENT THANK YOU', '500,000CR']], { previous: '4,000,000', closing: '5,000,000' })]],
    ];
    const balanceToday = async () => (await cardStatement(h.database, h.ws, h.card.id, { start: '2026-08-11', end: today }, today)).closingMinor;
    const bridges = async () => (await listTransactions(h.database, h.ws, { accountId: h.card.id })).filter((t) => t.externalRef?.startsWith('statement-bridge:'));
    expect(await balanceToday()).toBe(5_300_000);
    for (const [i, [period, images]] of periods.entries()) {
      const prepared = await h.prepare(images, period, today);
      expect(prepared.startsAfterPeriod).toBe(i === 0);
      const result = await recordStatementCheck(h.database, h.ws, { ...prepared, rows: categorised(prepared.rows, h.groceries) }, { ...NO_DECISIONS, moveStart: i === 0 });
      expect(result.status).toBe('reconciled');
      // Today's balance is what it was before the move, after the first check and after each later one.
      expect(await balanceToday()).toBe(5_300_000);
      // The history not yet checked is bridged on the old opening date; it shrinks as statements are checked.
      expect((await bridges()).map((b) => [b.occurredOn, b.entries.find((e) => e.accountId === h.card.id)?.amountMinor])).toEqual(
        i === 2 ? [] : [['2026-08-01', i === 0 ? -3_000_000 : -1_000_000]],
      );
    }
    const openings = (await listTransactions(h.database, h.ws, { accountId: h.card.id })).filter((t) => t.description.startsWith('Opening balance'));
    expect(openings).toHaveLength(1);
    expect(openings[0]!.occurredOn).toBe('2026-04-10');
  });

  /** A card opened on 1 Aug owing 5,500,000, and its four statements before that, newest first. */
  const catchUp = (): [StatementPeriod, CaptureLine[][]][] => [
    [{ start: '2026-07-11', end: '2026-08-10' }, [image([['15JUL', 'TOKO ALFA', '500,000']], { previous: '5,000,000', closing: '5,500,000' })]],
    [{ start: '2026-06-11', end: '2026-07-10' }, [image([['15JUN', 'TOKO ALFA', '1,500,000'], ['25JUN', 'PAYMENT THANK YOU', '500,000CR']], { previous: '4,000,000', closing: '5,000,000' })]],
    [{ start: '2026-05-11', end: '2026-06-10' }, [image([['15MAY', 'TOKO ALFA', '2,000,000']], { previous: '2,000,000', closing: '4,000,000' })]],
    [{ start: '2026-04-11', end: '2026-05-10' }, [image([['15APR', 'TOKO ALFA', '1,500,000'], ['25APR', 'PAYMENT THANK YOU', '500,000CR']], { previous: '1,000,000', closing: '2,000,000' })]],
  ];

  it('keeping the card’s start keeps today’s balance while older statements are checked newest first', async () => {
    const h = await household({ openingBalanceMinor: 5_500_000, openedOn: '2026-08-01' });
    await h.buy('2026-08-15', 'SETELAH MULAI', 300_000);
    const today = '2026-09-01';
    const balanceToday = async () => (await cardStatement(h.database, h.ws, h.card.id, { start: '2026-08-11', end: today }, today)).closingMinor;
    expect(await balanceToday()).toBe(5_800_000);
    for (const [period, images] of catchUp()) {
      const prepared = await h.prepare(images, period, today);
      expect(prepared.startsAfterPeriod).toBe(true);
      await recordStatementCheck(h.database, h.ws, { ...prepared, rows: categorised(prepared.rows, h.groceries) }, NO_DECISIONS);
      expect(await balanceToday()).toBe(5_800_000);
    }
    // Checked again once the history is in, the newest one still reconciles and today's balance holds.
    const [july, images] = catchUp()[0]!;
    const again = await h.prepare(images, july, today);
    expect(await recordStatementCheck(h.database, h.ws, again, NO_DECISIONS)).toMatchObject({ status: 'reconciled' });
    expect(await balanceToday()).toBe(5_800_000);
  });

  it('a second start move keeps today’s balance and reconciles both statements', async () => {
    const h = await household({ openingBalanceMinor: 5_500_000, openedOn: '2026-08-01' });
    await h.buy('2026-08-15', 'SETELAH MULAI', 300_000);
    const today = '2026-09-01';
    const balanceToday = async () => (await cardStatement(h.database, h.ws, h.card.id, { start: '2026-08-11', end: today }, today)).closingMinor;
    const [, june, may] = catchUp();
    const ids: string[] = [];
    for (const [period, images] of [june!, may!]) {
      const prepared = await h.prepare(images, period, today);
      expect(prepared.startsAfterPeriod).toBe(true);
      const result = await recordStatementCheck(h.database, h.ws, { ...prepared, rows: categorised(prepared.rows, h.groceries) }, { ...NO_DECISIONS, moveStart: true });
      expect(result.status).toBe('reconciled');
      ids.push(result.checkId);
      expect(await balanceToday()).toBe(5_800_000);
    }
    // The June statement still closes where it said after the May move.
    const again = await h.prepare(june![1], june![0], today);
    expect(await recordStatementCheck(h.database, h.ws, again, NO_DECISIONS)).toMatchObject({ checkId: ids[0], status: 'reconciled' });
    expect((await listStatementChecks(h.database, h.ws, h.card.id)).map((c) => c.status)).toEqual(['reconciled', 'reconciled']);
    const openings = (await listTransactions(h.database, h.ws, { accountId: h.card.id })).filter((t) => t.description.startsWith('Opening balance'));
    expect(openings.map((t) => t.occurredOn)).toEqual(['2026-05-10']);
    expect(await balanceToday()).toBe(5_800_000);
  });

  it('refuses a statement older than the card’s start without its previous balance, posting nothing', async () => {
    const h = await household({ openingBalanceMinor: 2_000_000, openedOn: '2026-08-01' });
    const prepared = await h.prepare([image([['12MAY', 'TOKO ALFA', '100,000']], { closing: '100,000' })], MAY, '2026-09-01');
    expect(prepared).toMatchObject({ startsAfterPeriod: true, previousMinor: null, needsPreviousBalance: true });
    const before = await h.posted();
    await expect(recordStatementCheck(h.database, h.ws, { ...prepared, rows: categorised(prepared.rows, h.groceries) }, NO_DECISIONS)).rejects.toMatchObject({ code: 'NO_PREVIOUS_BALANCE' });
    expect(await h.posted()).toBe(before);
    expect((await h.balances())[h.card.id]).toBe(-2_000_000);
  });

  it('moving the start of a card owing nothing before the statement takes its opening away', async () => {
    const h = await household({ openingBalanceMinor: 2_000_000, openedOn: '2026-08-01' });
    const prepared = await h.prepare([image([['12MAY', 'TOKO ALFA', '100,000']], { previous: '0', closing: '100,000' })], MAY, '2026-09-01');
    expect(prepared).toMatchObject({ previousMinor: 0, startsAfterPeriod: true });
    const result = await recordStatementCheck(h.database, h.ws, { ...prepared, rows: categorised(prepared.rows, h.groceries) }, { ...NO_DECISIONS, moveStart: true });
    expect(result.status).toBe('reconciled');
    const txs = await listTransactions(h.database, h.ws, { accountId: h.card.id });
    expect(txs.filter((t) => t.description.startsWith('Opening balance'))).toEqual([]);
    expect((await h.balances())[h.card.id]).toBe(-2_000_000);
  });

  it('with payments not tracked, links a payment the owner recorded and leaves it out of the adjustment', async () => {
    const h = await household();
    await h.buy('2026-05-12', 'TOKO ALFA', 300_000);
    const paid = await h.pay('2026-05-21', 50_000);
    const prepared = await h.prepare([image([['12MAY', 'TOKO ALFA', '300,000'], ['20MAY', 'PAYMENT THANK YOU', '50,000CR'], ['22MAY', 'PEMBAYARAN', '20,000CR']], { previous: '0', closing: '230,000' })]);
    expect(prepared.rows.map((r) => r.outcome)).toMatchObject([{ status: 'matched' }, { status: 'matched', candidateIds: [paid] }, { status: 'payment-untracked' }]);
    expect(prepared).toMatchObject({ untrackedPaymentsMinor: 20_000, untrackedPaymentsCount: 1, flagged: [] });
    const result = await recordStatementCheck(h.database, h.ws, prepared, NO_DECISIONS);
    expect(result.status).toBe('reconciled');
    expect((await h.balances())[h.card.id]).toBe(-230_000);
    const adjustment = (await listTransactions(h.database, h.ws, { accountId: h.card.id })).filter((t) => t.description.startsWith('Payments not tracked'));
    expect(adjustment.map((t) => t.description)).toEqual(['Payments not tracked (1 payment)']);
    expect(await listStatementLinks(h.database, result.checkId)).toEqual(expect.arrayContaining([{ checkId: result.checkId, transactionId: paid, kind: 'matched' }]));
  });

  it('a re-check from screenshots that start a row later posts nothing twice', async () => {
    const h = await household();
    await setTrackPayments(h.database, h.card.id, true);
    const rows: Printed[] = [['12MAY', 'TOKO ALFA', '100,000'], ['20MAY', 'PAYMENT THANK YOU', '50,000CR'], ['25MAY', 'TOKO BETA', '30,000'], ['25MAY', 'TOKO BETA', '30,000']];
    const first = await h.prepare([image(rows, { closing: '110,000' })]);
    await recordStatementCheck(h.database, h.ws, { ...first, rows: categorised(first.rows, h.groceries) }, NO_DECISIONS);
    const count = await h.posted();
    const later = await h.prepare([image(rows.slice(1), { closing: '110,000' })]);
    expect(later.rows.map((r) => r.outcome.status)).toEqual(['matched', 'matched', 'matched']);
    await recordStatementCheck(h.database, h.ws, { ...later, rows: categorised(later.rows, h.groceries) }, NO_DECISIONS);
    expect(await h.posted()).toBe(count);
    expect((await h.balances())[h.card.id]).toBe(-110_000);
  });

  it('files a refund with nothing to go back under as Refunds, and makes Fees & charges when it is gone', async () => {
    const h = await household();
    await h.database.execScript(`UPDATE accounts SET archived_at = '2026-01-01T00:00:00Z' WHERE system_key = 'miscellaneous.fees_charges'`);
    const prepared = await h.prepare([image([['14MAY', 'TOKO ZETA', '30,000CR'], ['25MAY', 'BIAYA MATERAI', '10,000']])]);
    const accounts = await listAccounts(h.database, h.ws);
    const refunds = accounts.find((a) => a.systemKey === 'miscellaneous.refunds')!;
    const fees = accounts.find((a) => a.systemKey === 'miscellaneous.fees_charges')!;
    const misc = accounts.find((a) => a.systemKey === 'miscellaneous')!;
    expect(refunds).toMatchObject({ name: 'Refunds', kind: 'expense', parentId: misc.id });
    expect(fees).toMatchObject({ name: 'Fees & charges', parentId: misc.id });
    expect(fees.id).not.toBe(h.fees);
    expect(prepared.rows.map((r) => [r.outcome.status, r.categoryId, r.categorySource])).toEqual([['missing', refunds.id, 'refund'], ['missing', fees.id, 'fee']]);
    // Asked again, the same categories are found, not made twice.
    await h.prepare([image([['14MAY', 'TOKO ZETA', '30,000CR']])]);
    expect((await listAccounts(h.database, h.ws)).filter((a) => a.systemKey === 'miscellaneous.refunds')).toHaveLength(1);
  });

  it('records a reversed fee as money back under Fees & charges, so a fee and its reversal owe nothing', async () => {
    const h = await household();
    const prepared = await h.prepare([image([['20MAY', 'ANNUAL FEE', '500,000'], ['21MAY', 'ANNUAL FEE REVERSAL', '500,000CR']], { previous: '0', closing: '0' })]);
    expect(prepared.rows.map((r) => [r.direction, r.outcome, r.categoryId, r.categorySource])).toEqual([
      ['out', { row: 0, status: 'missing', as: 'fee' }, h.fees, 'fee'],
      ['in', { row: 1, status: 'missing', as: 'refund' }, h.fees, 'fee'],
    ]);
    const result = await recordStatementCheck(h.database, h.ws, prepared, NO_DECISIONS);
    expect(result).toMatchObject({ status: 'reconciled', differenceMinor: 0 });
    const balances = await h.balances();
    expect(balances[h.card.id] ?? 0).toBe(0);
    expect(balances[h.fees] ?? 0).toBe(0);
  });

  it('refuses to record while a row the matcher could not decide is unanswered', async () => {
    const h = await household();
    await h.buy('2026-05-31', 'WARUNG', 55_000);
    await h.buy('2026-05-31', 'WARUNG', 55_000);
    const prepared = await h.prepare([image([['31MAY', 'WARUNG', '55,000']])]);
    await expect(recordStatementCheck(h.database, h.ws, prepared, NO_DECISIONS)).rejects.toMatchObject({ code: 'ASK_UNANSWERED' });
  });

  it('keeps a link’s kind and the stored balances on a re-check without a summary, and refuses a move to another currency', async () => {
    const h = await household();
    const usd = await createCardAccount(h.database, h.ws, { name: 'Dollar card', subtype: 'credit_card', currency: 'USD' });
    const stray = await h.buy('2026-05-20', 'NOT ON IT', 11_000);
    const images = [image([['12MAY', 'TOKO ALFA', '100,000']], { previous: '0', closing: '111,000' })];
    const prepared = await h.prepare(images);
    await expect(recordStatementCheck(h.database, h.ws, { ...prepared, rows: categorised(prepared.rows, h.groceries) }, { ...NO_DECISIONS, flagged: { [stray]: { moveTo: usd.id } } })).rejects.toMatchObject({ code: 'CURRENCY' });
    expect(await h.posted()).toBe(1);

    const first = await recordStatementCheck(h.database, h.ws, { ...prepared, rows: categorised(prepared.rows, h.groceries) }, NO_DECISIONS);
    const again = await h.prepare([image([['12MAY', 'TOKO ALFA', '100,000']])]);
    expect(again.closingMinor).toBeNull();
    const second = await recordStatementCheck(h.database, h.ws, again, NO_DECISIONS);
    expect(second).toMatchObject({ checkId: first.checkId, status: 'reconciled' });
    expect(await listStatementChecks(h.database, h.ws, h.card.id)).toMatchObject([{ closingMinor: 111_000, previousMinor: 0 }]);
    expect((await listStatementLinks(h.database, first.checkId)).map((l) => l.kind)).toEqual(['recorded']);
  });

  it('with payments tracked, records a missing payment as a visible card payment', async () => {
    const h = await household();
    await setTrackPayments(h.database, h.card.id, true);
    const prepared = await h.prepare([image([['20MAY', 'PAYMENT THANK YOU', '50,000CR']])]);
    expect(prepared.rows[0]!.outcome).toMatchObject({ status: 'missing', as: 'payment' });
    expect(prepared.untrackedPaymentsCount).toBe(0);
    const result = await recordStatementCheck(h.database, h.ws, prepared, NO_DECISIONS);
    const correction = await h.correction();
    const [payment] = await listTransactions(h.database, h.ws, { accountId: h.card.id });
    expect(payment).toMatchObject({ description: 'Card payment', excluded: false });
    expect(payment!.entries.find((e) => e.accountId === correction)?.amountMinor).toBe(-50_000);
    expect(await listStatementLinks(h.database, result.checkId)).toEqual([{ checkId: result.checkId, transactionId: payment!.id, kind: 'recorded' }]);
  });
});

describe('a card used from several workspaces', () => {
  it('matches a purchase filed in another workspace, posts nothing, and reconciles', async () => {
    current = await setupDb();
    const { database, ws } = current;
    const personal = (await listBooks(database, ws)).find((b) => b.kind === 'personal')!;
    const businessId = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    const home = inBook(ws, personal.id);
    const business = inBook(ws, businessId);
    const card = await createCardAccount(database, home, { name: 'Visa', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-01-01' });
    await saveCardTerms(database, home, { accountId: card.id, statementDay: 10, dueDay: 25, creditLimitMinor: null, annualFeeMinor: null });
    const lunch = (await categoryIdsByKey(database, business))['food_beverage.restaurants']!;
    const filed = await postTransaction(database, business, { occurredOn: '2026-05-20', description: 'CLIENT LUNCH', lines: expenseLines({ categoryAccountId: lunch, paymentAccountId: card.id, amountMinor: 450_000, currency: 'IDR' }) });
    const before = (await listTransactions(database, ownerScope(ws), { limit: 5000 })).length;

    const prepared = await prepareStatementCheck(database, home, { cardAccountId: card.id, period: MAY, images: [image([['20MAY', 'CLIENT LUNCH', '450,000']], { closing: '450,000' })], today: TODAY });
    expect(prepared.rows.map((r) => r.outcome)).toMatchObject([{ status: 'matched', candidateIds: [filed] }]);
    expect(prepared.flagged).toEqual([]);
    const result = await recordStatementCheck(database, home, prepared, NO_DECISIONS);
    expect(result).toMatchObject({ status: 'reconciled', differenceMinor: 0 });
    expect((await listTransactions(database, ownerScope(ws), { limit: 5000 })).length).toBe(before);
    expect((await nativeBalances(database, ws))[card.id]).toBe(-450_000);
  });
});

describe('the Track card payments setting', () => {
  it('is off by default and remembers being turned on', async () => {
    const h = await household();
    expect(await getTrackPayments(h.database, h.card.id)).toBe(false);
    await setTrackPayments(h.database, h.card.id, true);
    expect(await getTrackPayments(h.database, h.card.id)).toBe(true);
    await setTrackPayments(h.database, h.card.id, false);
    expect(await getTrackPayments(h.database, h.card.id)).toBe(false);
  });
});
