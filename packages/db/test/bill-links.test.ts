import { afterEach, expect, it } from 'vitest';
import {
  billDetail,
  billLinkCandidates,
  billLinkMonth,
  billLinkMonths,
  billLinkRefusal,
  billMonthsBefore,
  billOfPurchase,
  createAccount,
  linkPurchaseToBill,
  listAccounts,
  listTransactions,
  monthlyBills,
  postTransaction,
  RecurringError,
  recordBillPayments,
  relinkPurchaseToBill,
  replaceTransaction,
  saveExpenseTemplate,
  skipBill,
  undoBillPayments,
  unlinkPurchaseFromBill,
  voidTransaction,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

/** A bill that starts in October 2026, with purchases in its category in the months before. */
async function setup() {
  current = await setupDb();
  const { database, ws } = current;
  const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const internetCategory = category('utilities.internet_provider');
  const bill = await saveExpenseTemplate(database, ws, {
    name: 'Biznet Home', categoryAccountId: internetCategory, moneyAccountId: bca.id, amountMinor: 395_000, dayOfMonth: 10, startsMonth: '2026-10',
  });
  const buy = (occurredOn: string, amountMinor: number, categoryId = internetCategory, description = 'Biznet') =>
    postTransaction(database, ws, {
      occurredOn,
      description,
      lines: [
        { accountId: categoryId, amountMinor, currency: 'IDR' },
        { accountId: bca.id, amountMinor: -amountMinor, currency: 'IDR' },
      ],
    });
  const code = async (run: Promise<unknown>) => {
    try {
      await run;
    } catch (e) {
      if (e instanceof RecurringError) return e.code;
      throw e;
    }
    return null;
  };
  const row = async (onDate: string) => (await monthlyBills(database, ws, onDate)).find((b) => b.id === bill)!;
  return { database, ws, bca, bill, category, internetCategory, buy, code, row };
}

const TODAY = '2026-10-28';

it('links a purchase to a month before the bill started, with the purchase date and amount, and lists it in History', async () => {
  const h = await setup();
  const march = await h.buy('2026-03-09', 392_000);
  await linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-03', transactionId: march, today: TODAY });

  const detail = await billDetail(h.database, h.ws, h.bill, TODAY);
  const entry = detail.history.find((m) => m.month === '2026-03')!;
  expect(entry).toMatchObject({ state: 'paid', paidOn: '2026-03-09', paidMinor: 392_000, paymentId: march });
  expect(entry.payments).toEqual([{ id: march, paidMinor: 392_000, paidCurrency: 'IDR', linked: true }]);
  // The start month, and the card the bill shows, are where they were.
  expect(detail.bill.startsMonth).toBe('2026-10');
  expect(detail.bill.billMonth).toBe('2026-10');
  expect(detail.bill.state).toBe('overdue');
  expect(await billOfPurchase(h.database, h.ws, march)).toMatchObject({ templateId: h.bill, billMonth: '2026-03', linked: true });
});

it('a payment Pay recorded is not marked linked', async () => {
  const h = await setup();
  const [id] = await recordBillPayments(h.database, h.ws, { paidOn: '2026-10-09', payments: [{ templateId: h.bill, billMonth: '2026-10', amountMinor: 395_000 }] });
  const month = (await billDetail(h.database, h.ws, h.bill, TODAY)).history.find((m) => m.month === '2026-10')!;
  expect(month.payments[0]).toMatchObject({ id, linked: false });
  expect(await h.code(unlinkPurchaseFromBill(h.database, h.ws, { transactionId: id! }))).toBe('NOT_LINKED');
  expect(await billOfPurchase(h.database, h.ws, id!)).toMatchObject({ linked: false });
});

it('linking an earlier month changes no total and the hero still speaks for the current month', async () => {
  const h = await setup();
  const before = await h.row(TODAY);
  const all = await monthlyBills(h.database, h.ws, TODAY);
  const march = await h.buy('2026-03-09', 392_000);
  await linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-03', transactionId: march, today: TODAY });
  expect(await h.row(TODAY)).toEqual(before);
  expect(await monthlyBills(h.database, h.ws, TODAY)).toEqual(all);
});

it('does not move the purchase in a spending report: it stays on the day it was spent', async () => {
  const h = await setup();
  const id = await h.buy('2026-09-20', 395_000);
  await linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-08', transactionId: id, today: TODAY });
  const [tx] = await listTransactions(h.database, h.ws, { from: '2026-09-01', to: '2026-09-30' });
  expect(tx).toMatchObject({ id, occurredOn: '2026-09-20', billMonth: '2026-08' });
});

it('linking the current month moves it to paid with the purchase date; Pay is then refused for it; unlink restores unpaid', async () => {
  const h = await setup();
  const id = await h.buy('2026-10-09', 392_000);
  expect(await h.row(TODAY)).toMatchObject({ billMonth: '2026-10', state: 'overdue', paidOn: null });
  await linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-10', transactionId: id, today: TODAY });
  expect(await h.row(TODAY)).toMatchObject({ state: 'paid', paidOn: '2026-10-09', paidMinor: 392_000, paymentId: id, paidFromAccountId: h.bca.id });

  expect(await h.code(recordBillPayments(h.database, h.ws, { paidOn: TODAY, payments: [{ templateId: h.bill, billMonth: '2026-10', amountMinor: 395_000 }] }))).toBe('ALREADY_SETTLED');

  await unlinkPurchaseFromBill(h.database, h.ws, { transactionId: id });
  expect(await h.row(TODAY)).toMatchObject({ state: 'overdue', paidOn: null });
  // The purchase is still there, untouched.
  const [tx] = await listTransactions(h.database, h.ws, { from: '2026-10-01', to: '2026-10-31' });
  expect(tx).toMatchObject({ id, status: 'posted', occurredOn: '2026-10-09', billMonth: null });
  expect(await billOfPurchase(h.database, h.ws, id)).toBeNull();
});

it('refuses a month already paid by a payment, a skipped month, a month ahead, a linked purchase, and a purchase that is not an expense', async () => {
  const h = await setup();
  const [paid] = await recordBillPayments(h.database, h.ws, { paidOn: '2026-10-09', payments: [{ templateId: h.bill, billMonth: '2026-10', amountMinor: 395_000 }] });
  const october = await h.buy('2026-10-12', 395_000);
  expect(await h.code(linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-10', transactionId: october, today: TODAY }))).toBe('ALREADY_SETTLED');

  await skipBill(h.database, h.ws, h.bill, '2026-02');
  const feb = await h.buy('2026-02-05', 395_000);
  expect(await h.code(linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-02', transactionId: feb, today: TODAY }))).toBe('SKIPPED');

  expect(await h.code(linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2027-03', transactionId: feb, today: TODAY }))).toBe('MONTH_AHEAD');
  expect(await h.code(linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-3', transactionId: feb, today: TODAY }))).toBe('MONTH_FORMAT');

  // Already linked anywhere: not twice, not to a second month.
  const march = await h.buy('2026-03-09', 392_000);
  await linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-03', transactionId: march, today: TODAY });
  expect(await h.code(linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-04', transactionId: march, today: TODAY }))).toBe('ALREADY_LINKED');
  // A payment Pay recorded counts as linked too.
  expect(await h.code(linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-04', transactionId: paid!, today: TODAY }))).toBe('ALREADY_LINKED');

  // A transfer is not a purchase; a voided purchase is gone.
  const savings = await createAccount(h.database, h.ws, { name: 'Savings', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const transfer = await postTransaction(h.database, h.ws, { occurredOn: '2026-04-01', description: 'Move', lines: [{ accountId: savings.id, amountMinor: 1_000, currency: 'IDR' }, { accountId: h.bca.id, amountMinor: -1_000, currency: 'IDR' }] });
  expect(await h.code(linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-04', transactionId: transfer, today: TODAY }))).toBe('NOT_A_PURCHASE');
  const gone = await h.buy('2026-04-02', 395_000);
  await voidTransaction(h.database, h.ws, gone);
  expect(await h.code(linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-04', transactionId: gone, today: TODAY }))).toBe('NOT_A_PURCHASE');
});

it('moves a linked purchase to another month or another bill in one step, and the month it left is owed again', async () => {
  const h = await setup();
  // Invented: a second bill in another category, and one purchase linked to March of the first.
  const water = await saveExpenseTemplate(h.database, h.ws, {
    name: 'PDAM water', categoryAccountId: h.category('utilities.water_sanitation'), moneyAccountId: h.bca.id, amountMinor: 118_000, dayOfMonth: 5, startsMonth: '2026-10',
  });
  const march = await h.buy('2026-03-09', 392_000);
  await linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-03', transactionId: march, today: TODAY });

  // Another month of the same bill: March is owed again, April is paid by it.
  await relinkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-04', transactionId: march, today: TODAY });
  expect(await billOfPurchase(h.database, h.ws, march)).toMatchObject({ templateId: h.bill, billMonth: '2026-04', linked: true });
  const history = (await billDetail(h.database, h.ws, h.bill, TODAY)).history;
  expect(history.find((m) => m.month === '2026-04')).toMatchObject({ state: 'paid', paymentId: march });
  expect(history.find((m) => m.month === '2026-03')?.state).not.toBe('paid');

  // Another bill altogether.
  await relinkPurchaseToBill(h.database, h.ws, { templateId: water, billMonth: '2026-10', transactionId: march, today: TODAY });
  expect(await billOfPurchase(h.database, h.ws, march)).toMatchObject({ templateId: water, billMonth: '2026-10', linked: true });
  expect((await billDetail(h.database, h.ws, h.bill, TODAY)).history.find((m) => m.month === '2026-04')?.state).not.toBe('paid');

  // The same bill and month again: nothing changes, nothing is refused.
  await relinkPurchaseToBill(h.database, h.ws, { templateId: water, billMonth: '2026-10', transactionId: march, today: TODAY });
  expect(await billOfPurchase(h.database, h.ws, march)).toMatchObject({ templateId: water, billMonth: '2026-10' });

  // A purchase linked to nothing is simply linked.
  const loose = await h.buy('2026-05-07', 390_000);
  await relinkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-05', transactionId: loose, today: TODAY });
  expect(await billOfPurchase(h.database, h.ws, loose)).toMatchObject({ templateId: h.bill, billMonth: '2026-05', linked: true });
});

it('a refused move leaves the link where it was, and a payment Pay recorded is never moved', async () => {
  const h = await setup();
  const march = await h.buy('2026-03-09', 392_000);
  await linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-03', transactionId: march, today: TODAY });
  const [paid] = await recordBillPayments(h.database, h.ws, { paidOn: '2026-10-09', payments: [{ templateId: h.bill, billMonth: '2026-10', amountMinor: 395_000 }] });

  // October is settled by Pay's payment: the move is refused and March keeps its purchase.
  expect(await h.code(relinkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-10', transactionId: march, today: TODAY }))).toBe('ALREADY_SETTLED');
  expect(await h.code(relinkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2027-03', transactionId: march, today: TODAY }))).toBe('MONTH_AHEAD');
  expect(await billOfPurchase(h.database, h.ws, march)).toMatchObject({ templateId: h.bill, billMonth: '2026-03', linked: true });

  // Pay's own payment is undone on the bill, never moved from here.
  expect(await h.code(relinkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-04', transactionId: paid!, today: TODAY }))).toBe('NOT_LINKED');
  expect(await billOfPurchase(h.database, h.ws, paid!)).toMatchObject({ billMonth: '2026-10', linked: false });
});

it('allows two purchases in one month to be offered, links one, and offers the other for no other month', async () => {
  const h = await setup();
  const first = await h.buy('2026-03-09', 392_000);
  const second = await h.buy('2026-03-24', 150_000);
  const list = await billLinkCandidates(h.database, h.ws, { templateId: h.bill, billMonth: '2026-03' });
  expect(list.map((c) => c.transactionId)).toEqual([second, first]);
  expect(list[1]).toMatchObject({ amountMinor: 392_000, currency: 'IDR', occurredOn: '2026-03-09', payerAccountId: h.bca.id, isClose: true, description: 'Biznet' });
  expect(list[0]!.isClose).toBe(false);

  await linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-03', transactionId: first, today: TODAY });
  expect((await billLinkCandidates(h.database, h.ws, { templateId: h.bill, billMonth: '2026-03' })).map((c) => c.transactionId)).toEqual([second]);
  // A second purchase for a month that is now paid is refused, so one month never holds a purchase it did not need.
  expect(await h.code(linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-03', transactionId: second, today: TODAY }))).toBe('ALREADY_SETTLED');
});

it('candidates are the category only, posted, unlinked, with a close flag within ten per cent', async () => {
  const h = await setup();
  const edge = await h.buy('2026-09-05', 434_500); // exactly +10%
  const over = await h.buy('2026-09-06', 434_501);
  const low = await h.buy('2026-09-07', 355_500); // exactly -10%
  await h.buy('2026-09-08', 395_000, h.category('utilities.electricity'), 'PLN');
  const voided = await h.buy('2026-09-09', 395_000);
  await voidTransaction(h.database, h.ws, voided);
  const list = await billLinkCandidates(h.database, h.ws, { templateId: h.bill, billMonth: '2026-09' });
  expect(list.map((c) => [c.transactionId, c.isClose])).toEqual([[low, true], [over, false], [edge, true]]);
});

it('a bill with no fixed amount flags nothing as close', async () => {
  const h = await setup();
  const varying = await saveExpenseTemplate(h.database, h.ws, { name: 'Water', categoryAccountId: h.category('utilities.water_sanitation'), moneyAccountId: h.bca.id, amountMinor: null, dayOfMonth: 5, startsMonth: '2026-10' });
  await h.buy('2026-08-05', 90_000, h.category('utilities.water_sanitation'), 'PDAM');
  const list = await billLinkCandidates(h.database, h.ws, { templateId: varying, billMonth: '2026-08' });
  expect(list).toHaveLength(1);
  expect(list[0]!.isClose).toBe(false);
});

it('lists the months before the start with counts, newest first, hiding linked ones, paging by a limit', async () => {
  const h = await setup();
  await h.buy('2026-09-09', 392_000);
  await h.buy('2026-03-09', 392_000);
  const march2 = await h.buy('2026-03-24', 200_000);
  await h.buy('2026-01-10', 50_000);
  await h.buy('2025-11-20', 395_000);
  // This month and after are not "earlier".
  await h.buy('2026-10-02', 395_000);

  const first = await billMonthsBefore(h.database, h.ws, { templateId: h.bill, limitMonths: 12 });
  expect(first.months.map((m) => [m.month, m.count, m.closeCount])).toEqual([
    ['2026-09', 1, 1],
    ['2026-08', 0, 0],
    ['2026-07', 0, 0],
    ['2026-06', 0, 0],
    ['2026-05', 0, 0],
    ['2026-04', 0, 0],
    ['2026-03', 2, 1],
    ['2026-02', 0, 0],
    ['2026-01', 1, 0],
    ['2025-12', 0, 0],
    ['2025-11', 1, 1],
  ]);
  expect(first.nextFrom).toBeNull();

  const paged = await billMonthsBefore(h.database, h.ws, { templateId: h.bill, limitMonths: 4 });
  expect(paged.months.map((m) => m.month)).toEqual(['2026-09', '2026-08', '2026-07', '2026-06']);
  expect(paged.nextFrom).toBe('2026-05');
  const next = await billMonthsBefore(h.database, h.ws, { templateId: h.bill, fromMonth: paged.nextFrom!, limitMonths: 4 });
  expect(next.months.map((m) => m.month)).toEqual(['2026-05', '2026-04', '2026-03', '2026-02']);

  await linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-03', transactionId: march2, today: TODAY });
  expect((await billMonthsBefore(h.database, h.ws, { templateId: h.bill, limitMonths: 12 })).months.map((m) => m.month)).not.toContain('2026-03');
});

it('no category purchase before the start means nothing to list', async () => {
  const h = await setup();
  await h.buy('2026-10-02', 395_000);
  expect(await billMonthsBefore(h.database, h.ws, { templateId: h.bill })).toEqual({ months: [], nextFrom: null });
});

it('a yearly bill offers only the months it comes out in', async () => {
  const h = await setup();
  const yearly = await saveExpenseTemplate(h.database, h.ws, {
    name: 'Car insurance', categoryAccountId: h.category('utilities.water_sanitation'), moneyAccountId: h.bca.id, amountMinor: 4_800_000, dayOfMonth: 15, repeat: 'yearly', repeatMonth: 3, startsMonth: '2027-03',
  });
  await h.buy('2026-03-14', 4_700_000, h.category('utilities.water_sanitation'), 'Insurance');
  await h.buy('2026-05-14', 100_000, h.category('utilities.water_sanitation'), 'Other');
  const list = await billMonthsBefore(h.database, h.ws, { templateId: yearly });
  expect(list.months.map((m) => m.month)).toEqual(['2026-03']);
  expect(await h.code(linkPurchaseToBill(h.database, h.ws, { templateId: yearly, billMonth: '2026-05', transactionId: (await billLinkCandidates(h.database, h.ws, { templateId: yearly, billMonth: '2026-05' }))[0]!.transactionId, today: TODAY }))).toBe('NOT_OWED');
});

it('a yearly bill takes a purchase in the occurrence nearest it, and its next one early once this one is paid', async () => {
  const h = await setup();
  const water = h.category('utilities.water_sanitation');
  const yearly = await saveExpenseTemplate(h.database, h.ws, {
    name: 'Car insurance', categoryAccountId: water, moneyAccountId: h.bca.id, amountMinor: 4_800_000, dayOfMonth: 15, repeat: 'yearly', repeatMonth: 3, startsMonth: '2026-03',
  });
  const MARCH = '2026-03-20';
  // Paid for this year on its page; a second purchase this month is for next year's, paid early.
  await recordBillPayments(h.database, h.ws, { paidOn: '2026-03-16', payments: [{ templateId: yearly, billMonth: '2026-03', amountMinor: 4_800_000 }] });
  const early = await h.buy(MARCH, 4_650_000, water, 'Insurance 2027');
  expect(await billLinkRefusal(h.database, h.ws, { templateId: yearly, billMonth: '2027-03', today: MARCH })).toBeNull();
  // Two years ahead is still not out.
  expect((await billLinkRefusal(h.database, h.ws, { templateId: yearly, billMonth: '2028-03', today: MARCH }))?.code).toBe('MONTH_AHEAD');
  await linkPurchaseToBill(h.database, h.ws, { templateId: yearly, billMonth: '2027-03', transactionId: early, today: MARCH });
  expect(await billOfPurchase(h.database, h.ws, early)).toMatchObject({ templateId: yearly, billMonth: '2027-03' });

  // The month a purchase starts at: the occurrence nearest its date, not its own month (which the bill does not come out in).
  // This year's paid, next year's linked early: whichever is nearer, asked.
  expect(await billLinkMonth(h.database, h.ws, { templateId: yearly, purchasedOn: '2026-04-02', today: TODAY })).toMatchObject({ month: '2026-03', ask: true });
  expect(await billLinkMonth(h.database, h.ws, { templateId: yearly, purchasedOn: '2026-12-01', today: TODAY })).toMatchObject({ month: '2027-03', ask: true });
  // A monthly bill starts at the purchase's own month, as it always has.
  expect((await billLinkMonth(h.database, h.ws, { templateId: h.bill, purchasedOn: '2026-08-30', today: TODAY })).month).toBe('2026-08');
});

it('an every-few-months bill takes the occurrence nearest the purchase, and its next one early', async () => {
  const h = await setup();
  const water = h.category('utilities.water_sanitation');
  // August, November, February, May.
  const quarterly = await saveExpenseTemplate(h.database, h.ws, {
    name: 'Water filter service', categoryAccountId: water, moneyAccountId: h.bca.id, amountMinor: 275_000, dayOfMonth: 20, repeat: 'months', repeatMonth: 8, repeatEvery: 3, startsMonth: '2026-08',
  });
  const NOV = '2026-11-24';
  expect((await billLinkMonth(h.database, h.ws, { templateId: quarterly, purchasedOn: '2026-10-01', today: NOV })).month).toBe('2026-08');
  // Nearer November, but August is out and unpaid: August, paid late.
  expect((await billLinkMonth(h.database, h.ws, { templateId: quarterly, purchasedOn: '2026-10-12', today: NOV })).month).toBe('2026-08');
  await recordBillPayments(h.database, h.ws, { paidOn: '2026-11-20', payments: [{ templateId: quarterly, billMonth: '2026-11', amountMinor: 275_000 }] });
  expect(await billLinkRefusal(h.database, h.ws, { templateId: quarterly, billMonth: '2027-02', today: NOV })).toBeNull();
  expect((await billLinkRefusal(h.database, h.ws, { templateId: quarterly, billMonth: '2027-05', today: NOV }))?.code).toBe('MONTH_AHEAD');
  expect((await billLinkRefusal(h.database, h.ws, { templateId: quarterly, billMonth: '2026-12', today: NOV }))?.code).toBe('NOT_OWED');
});

it('a monthly bill out on the 25th, paid by the 5th, takes a payment in the month whose window holds it', async () => {
  const h = await setup();
  const water = h.category('utilities.water_sanitation');
  const later = await saveExpenseTemplate(h.database, h.ws, {
    name: 'Apartment service', categoryAccountId: water, moneyAccountId: h.bca.id, amountMinor: 640_000, dayOfMonth: 25, payByDay: 5, startsMonth: '2026-09',
  });
  const at = (purchasedOn: string, today = '2026-11-13') => billLinkMonth(h.database, h.ws, { templateId: later, purchasedOn, today });
  expect(await at('2026-10-27')).toMatchObject({ month: '2026-10', ask: false });
  expect(await at('2026-11-03')).toMatchObject({ month: '2026-10', ask: false });
  // Past October's pay-by day, October still owed: paid late, still October's.
  expect(await at('2026-11-10')).toMatchObject({ month: '2026-10', ask: false });
  await recordBillPayments(h.database, h.ws, { paidOn: '2026-10-28', payments: [{ templateId: later, billMonth: '2026-10', amountMinor: 640_000 }] });
  // October paid: a payment on 3 Nov is November's, which is not out until the 25th — asked first.
  expect(await at('2026-11-03')).toEqual({ month: '2026-11', ask: true, opensOn: '2026-11-25' });
  expect(await at('2026-11-26', '2026-11-26')).toMatchObject({ month: '2026-11', ask: false });
  // Bought 27 Oct, inside October's window, October paid: never September in silence — October, asked.
  expect(await at('2026-10-27')).toMatchObject({ month: '2026-10', ask: true });
});

it('the quick link never moves a link the purchase has: linking it to another bill is refused, and it stays', async () => {
  const h = await setup();
  const other = await saveExpenseTemplate(h.database, h.ws, {
    name: 'Router rental', categoryAccountId: h.internetCategory, moneyAccountId: h.bca.id, amountMinor: 45_000, dayOfMonth: 12, startsMonth: '2026-09',
  });
  const purchase = await h.buy('2026-10-09', 395_000);
  await linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-10', transactionId: purchase, today: TODAY });
  // As a tap made before the screen knew of that link would ask: refused, nothing moved.
  expect(await h.code(linkPurchaseToBill(h.database, h.ws, { templateId: other, billMonth: '2026-10', transactionId: purchase, today: TODAY }))).toBe('ALREADY_LINKED');
  expect(await billOfPurchase(h.database, h.ws, purchase)).toMatchObject({ templateId: h.bill, billMonth: '2026-10' });
  const otherOctober = (await billDetail(h.database, h.ws, other, TODAY)).history.find((m) => m.month === '2026-10');
  expect(otherOctober?.state).not.toBe('paid');
});

it('reads the months of many bills in one go, each as it reads alone', async () => {
  const h = await setup();
  const later = await saveExpenseTemplate(h.database, h.ws, {
    name: 'Apartment service', categoryAccountId: h.category('utilities.water_sanitation'), moneyAccountId: h.bca.id, amountMinor: 640_000, dayOfMonth: 25, payByDay: 5, startsMonth: '2026-09',
  });
  const read = { purchasedOn: '2026-11-03', today: '2026-11-13' };
  const all = await billLinkMonths(h.database, h.ws, { templateIds: [h.bill, later], ...read });
  expect(all[h.bill]).toEqual(await billLinkMonth(h.database, h.ws, { templateId: h.bill, ...read }));
  expect(all[later]).toEqual({ month: '2026-10', ask: false, opensOn: '2026-10-25' });
  expect(await billLinkMonths(h.database, h.ws, { templateIds: [], ...read })).toEqual({});
  // A month already paid would be refused: asked, so the list says so before the tap.
  await recordBillPayments(h.database, h.ws, { paidOn: '2026-11-02', payments: [{ templateId: h.bill, billMonth: '2026-11', amountMinor: 395_000 }] });
  expect((await billLinkMonths(h.database, h.ws, { templateIds: [h.bill], ...read }))[h.bill]).toMatchObject({ month: '2026-11', ask: true });
});

it('a pay-later bill started in November never takes a 3 Nov payment as October\'s', async () => {
  const h = await setup();
  const fresh = await saveExpenseTemplate(h.database, h.ws, {
    name: 'Parking pass', categoryAccountId: h.category('utilities.water_sanitation'), moneyAccountId: h.bca.id, amountMinor: 310_000, dayOfMonth: 25, payByDay: 5, startsMonth: '2026-11',
  });
  expect(await billLinkMonth(h.database, h.ws, { templateId: fresh, purchasedOn: '2026-11-03', today: '2026-11-03' })).toEqual({ month: '2026-11', ask: true, opensOn: '2026-11-25' });
});

it('a purchase from another category can be linked, and counts as the bill month with its own figure', async () => {
  const h = await setup();
  const other = await h.buy('2026-09-03', 380_000, h.category('utilities.electricity'), 'Wifi top-up');
  await linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-09', transactionId: other, today: TODAY });
  const month = (await billDetail(h.database, h.ws, h.bill, TODAY)).history.find((m) => m.month === '2026-09')!;
  expect(month).toMatchObject({ state: 'paid', paidMinor: 380_000, paidCurrency: 'IDR', paidFromAccountId: h.bca.id });
});

it('keeps a foreign figure the way Pay does', async () => {
  const h = await setup();
  const id = await postTransaction(h.database, h.ws, {
    occurredOn: '2026-09-03',
    description: 'Biznet',
    originalCurrency: 'USD',
    originalAmountMinor: 2_500,
    ratesToBase: { USD: 16_000 },
    lines: [
      { accountId: h.internetCategory, amountMinor: 400_000, currency: 'IDR' },
      { accountId: h.bca.id, amountMinor: -400_000, currency: 'IDR' },
    ],
  });
  await linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-09', transactionId: id, today: TODAY });
  const month = (await billDetail(h.database, h.ws, h.bill, TODAY)).history.find((m) => m.month === '2026-09')!;
  expect(month).toMatchObject({ paidMinor: 2_500, paidCurrency: 'USD', chargedMinor: 400_000, chargedCurrency: 'IDR' });
});

it('Undo payment still voids a Pay payment; a linked purchase survives an edit with its link', async () => {
  const h = await setup();
  const id = await h.buy('2026-03-09', 392_000);
  await linkPurchaseToBill(h.database, h.ws, { templateId: h.bill, billMonth: '2026-03', transactionId: id, today: TODAY });
  const edited = await replaceTransaction(h.database, h.ws, id, {
    occurredOn: '2026-03-10',
    description: 'Biznet fiber',
    lines: [
      { accountId: h.internetCategory, amountMinor: 393_000, currency: 'IDR' },
      { accountId: h.bca.id, amountMinor: -393_000, currency: 'IDR' },
    ],
  });
  expect(edited).not.toBe(id);
  expect(await billOfPurchase(h.database, h.ws, edited)).toMatchObject({ billMonth: '2026-03', linked: true });
  expect((await billDetail(h.database, h.ws, h.bill, TODAY)).history.find((m) => m.month === '2026-03')).toMatchObject({ state: 'paid', paidOn: '2026-03-10', paidMinor: 393_000 });

  const [pay] = await recordBillPayments(h.database, h.ws, { paidOn: '2026-10-09', payments: [{ templateId: h.bill, billMonth: '2026-10', amountMinor: 395_000 }] });
  await undoBillPayments(h.database, h.ws, [pay!]);
  expect(await h.row(TODAY)).toMatchObject({ state: 'overdue' });

  // Deleting the linked purchase puts the month back to unpaid.
  await voidTransaction(h.database, h.ws, edited);
  expect((await billDetail(h.database, h.ws, h.bill, TODAY)).history.find((m) => m.month === '2026-03')).toBeUndefined();
});
