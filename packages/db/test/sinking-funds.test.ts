import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  addSinkingExtra,
  createAccount,
  deleteExpenseTemplate,
  listAccounts,
  listExpenseTemplates,
  listSinkingFunds,
  nativeBalances,
  recordBillPayments,
  saveExpenseTemplate,
  setAsideView,
  sinkingFundOf,
  sinkingFundViews,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-10T12:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
  current?.executor.close();
  current = undefined;
});

async function household() {
  current = await setupDb();
  const { database, ws } = current;
  const savings = await createAccount(database, ws, { name: 'BCA Savings', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-01-01' });
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-01-01' });
  const card = await createAccount(database, ws, { name: 'Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const category = (await listAccounts(database, ws)).find((a) => a.systemKey === 'personal_care.sports_fitness')!.id;
  const base = { categoryAccountId: category, moneyAccountId: bank.id };
  const insurance = await saveExpenseTemplate(database, ws, {
    ...base,
    name: 'Car insurance',
    dayOfMonth: 12,
    amountMinor: 3_750_000,
    repeat: 'yearly',
    repeatMonth: 11,
    fund: { accountId: savings.id },
  });
  return { database, ws, savings, bank, card, category, base, insurance };
}
type House = Awaited<ReturnType<typeof household>>;

const setAsideOf = async (h: House, date: string, accountId = h.savings.id) => (await setAsideView(h.database, h.ws, accountId, { date }))?.setAsideMinor ?? 0;

it('works the monthly figure out from the amount and the months left, and starts the fund this month', async () => {
  const h = await household();
  expect(await listSinkingFunds(h.database.db, h.ws)).toMatchObject([{ billId: h.insurance, accountId: h.savings.id, monthlyMinor: 468_750, startedMonth: '2026-03', entries: [] }]);
});

it('keeps a monthly figure the owner typed', async () => {
  const h = await household();
  const other = await saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'Property tax', dayOfMonth: 5, amountMinor: 2_000_000, repeat: 'yearly', repeatMonth: 12, fund: { accountId: h.savings.id, monthlyMinor: 300_000 } });
  expect((await listSinkingFunds(h.database.db, h.ws)).find((f) => f.billId === other)?.monthlyMinor).toBe(300_000);
});

it('refuses a bill whose amount varies, and the bill is not saved either', async () => {
  const h = await household();
  await expect(
    saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'Varies', dayOfMonth: 5, amountMinor: null, repeat: 'yearly', repeatMonth: 12, fund: { accountId: h.savings.id } }),
  ).rejects.toMatchObject({ code: 'FUND_AMOUNT' });
  expect((await listExpenseTemplates(h.database, h.ws)).map((b) => b.name)).toEqual(['Car insurance']);
});

it('refuses an account in another currency than the bill, or one that is not money', async () => {
  const h = await household();
  const usd = await createAccount(h.database, h.ws, { name: 'Wise', kind: 'asset', subtype: 'bank', currency: 'USD', openingBalanceMinor: 100_000, openedOn: '2026-01-01', openingRateToBase: 16_000 });
  await expect(saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'X', dayOfMonth: 5, amountMinor: 1_000_000, repeat: 'yearly', repeatMonth: 12, fund: { accountId: usd.id } })).rejects.toMatchObject({ code: 'FUND_CURRENCY' });
  await expect(saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'X', dayOfMonth: 5, amountMinor: 1_000_000, repeat: 'yearly', repeatMonth: 12, fund: { accountId: h.card.id } })).rejects.toMatchObject({ code: 'FUND_ACCOUNT' });
});

it('sets aside the monthly figure for every month begun, never above the bill, and nothing before the start', async () => {
  const h = await household();
  expect(await setAsideOf(h, '2026-03-10')).toBe(468_750);
  expect(await setAsideOf(h, '2026-05-31')).toBe(3 * 468_750);
  expect(await setAsideOf(h, '2026-11-05')).toBe(3_750_000);
  expect(await setAsideOf(h, '2026-12-20')).toBe(3_750_000);
  expect(await setAsideOf(h, '2026-02-20')).toBe(0);
  const view = await sinkingFundOf(h.database, h.ws, h.insurance, '2026-05-31');
  expect(view).toMatchObject({ savedMinor: 1_406_250, monthsDone: 3, monthsTotal: 8, dueMonth: '2026-11', accountName: 'BCA Savings' });
});

it('lowers what is free to spend, with two funds in one account', async () => {
  const h = await household();
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'Property tax', dayOfMonth: 5, amountMinor: 1_200_000, repeat: 'yearly', repeatMonth: 5, fund: { accountId: h.savings.id } });
  // May tax: March and April before it, 600,000 a month.
  const view = (await setAsideView(h.database, h.ws, h.savings.id, { date: '2026-04-15' }))!;
  expect(view.setAsideMinor).toBe(2 * 468_750 + 2 * 600_000);
  expect(view.freeMinor).toBe(20_000_000 - view.setAsideMinor);
  expect(view.funds.map((f) => f.name).sort()).toEqual(['Car insurance', 'Property tax']);
  // The other account is untouched.
  expect(await setAsideView(h.database, h.ws, h.bank.id, { date: '2026-04-15' })).toBeNull();
});

it('puts in extra, up to the bill', async () => {
  const h = await household();
  await addSinkingExtra(h.database.db, h.ws, h.insurance, 1_000_000);
  expect(await setAsideOf(h, '2026-03-10')).toBe(1_468_750);
  await addSinkingExtra(h.database.db, h.ws, h.insurance, 9_000_000);
  expect(await setAsideOf(h, '2026-03-10')).toBe(3_750_000);
});

it('an edit keeps the start and the extras, and can change the account and the figure', async () => {
  const h = await household();
  await addSinkingExtra(h.database.db, h.ws, h.insurance, 100_000);
  vi.setSystemTime(new Date('2026-06-02T12:00:00'));
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: h.insurance, name: 'Car insurance', dayOfMonth: 12, amountMinor: 3_750_000, fund: { accountId: h.bank.id, monthlyMinor: 500_000 } });
  const [fund] = await listSinkingFunds(h.database.db, h.ws);
  expect(fund).toMatchObject({ billId: h.insurance, accountId: h.bank.id, baseMonthlyMinor: 468_750, currentMonthlyMinor: 500_000, startedMonth: '2026-03', custom: true });
  expect(fund!.entries.filter((e) => e.kind === 'extra').map((e) => e.amountMinor)).toEqual([100_000]);
  // Leaving the fund out of an edit leaves it as it was.
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: h.insurance, name: 'Car insurance', dayOfMonth: 12, amountMinor: 3_750_000 });
  expect(await listSinkingFunds(h.database.db, h.ws)).toHaveLength(1);
});

it('turning it off, deleting the bill, or making it monthly releases the money', async () => {
  const h = await household();
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: h.insurance, name: 'Car insurance', dayOfMonth: 12, amountMinor: 3_750_000, fund: null });
  expect(await listSinkingFunds(h.database.db, h.ws)).toEqual([]);
  expect(await setAsideOf(h, '2026-05-31')).toBe(0);

  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: h.insurance, name: 'Car insurance', dayOfMonth: 12, amountMinor: 3_750_000, fund: { accountId: h.savings.id } });
  expect(await setAsideOf(h, '2026-05-31')).toBe(1_406_250);
  await deleteExpenseTemplate(h.database, h.ws, h.insurance);
  expect(await listSinkingFunds(h.database.db, h.ws)).toEqual([]);
  expect(await setAsideOf(h, '2026-05-31')).toBe(0);

  const again = await saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'Gym', dayOfMonth: 5, amountMinor: 400_000, repeat: 'yearly', repeatMonth: 9, fund: { accountId: h.savings.id } });
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: again, name: 'Gym', dayOfMonth: 5, amountMinor: 400_000, repeat: 'monthly' });
  expect(await listSinkingFunds(h.database.db, h.ws)).toEqual([]);
});

const balances = (h: House) => nativeBalances(h.database, h.ws);

it('paying by credit card with the fund: the purchase, the card payment from the fund account, and the release, together', async () => {
  const h = await household();
  vi.setSystemTime(new Date('2026-11-12T12:00:00'));
  const before = await balances(h);
  const ids = await recordBillPayments(h.database, h.ws, {
    paidOn: '2026-11-12',
    payments: [{ templateId: h.insurance, billMonth: '2026-11', amountMinor: 3_750_000, moneyAccountId: h.card.id, payCardFromFund: true }],
  });
  expect(ids).toHaveLength(2);
  const after = await balances(h);
  // The card was charged and paid off: it nets to nothing. The savings account paid the card.
  expect((after[h.card.id] ?? 0) - (before[h.card.id] ?? 0)).toBe(0);
  expect((after[h.savings.id] ?? 0) - (before[h.savings.id] ?? 0)).toBe(-3_750_000);
  expect(await listSinkingFunds(h.database.db, h.ws)).toEqual([]);
  expect(await sinkingFundViews(h.database, h.ws, '2026-11-12')).toEqual([]);
  expect(await setAsideOf(h, '2026-11-12')).toBe(0);
  const rows = await h.database.db.values<[string]>(sql`SELECT description FROM transactions WHERE status = 'posted' AND occurred_on = '2026-11-12'`);
  expect(rows.map((r) => r[0]).sort()).toEqual(['Car insurance', 'Visa payment']);
});

it('paying by card without paying the card from the fund records only the purchase and still releases', async () => {
  const h = await household();
  vi.setSystemTime(new Date('2026-11-12T12:00:00'));
  const before = await balances(h);
  const ids = await recordBillPayments(h.database, h.ws, {
    paidOn: '2026-11-12',
    payments: [{ templateId: h.insurance, billMonth: '2026-11', amountMinor: 3_750_000, moneyAccountId: h.card.id, payCardFromFund: false }],
  });
  expect(ids).toHaveLength(1);
  const after = await balances(h);
  expect((after[h.card.id] ?? 0) - (before[h.card.id] ?? 0)).toBe(-3_750_000);
  expect(after[h.savings.id]).toBe(before[h.savings.id]);
  expect(await listSinkingFunds(h.database.db, h.ws)).toEqual([]);
});

it('paying from the fund account is just the bill, and releases', async () => {
  const h = await household();
  vi.setSystemTime(new Date('2026-11-12T12:00:00'));
  const before = await balances(h);
  const ids = await recordBillPayments(h.database, h.ws, {
    paidOn: '2026-11-12',
    payments: [{ templateId: h.insurance, billMonth: '2026-11', amountMinor: 3_750_000, moneyAccountId: h.savings.id }],
  });
  expect(ids).toHaveLength(1);
  expect(((await balances(h))[h.savings.id] ?? 0) - (before[h.savings.id] ?? 0)).toBe(-3_750_000);
  expect(await listSinkingFunds(h.database.db, h.ws)).toEqual([]);
});

it('a failure in the batch undoes the purchase, the card payment and the release', async () => {
  const h = await household();
  vi.setSystemTime(new Date('2026-11-12T12:00:00'));
  const before = await balances(h);
  await expect(
    recordBillPayments(h.database, h.ws, {
      paidOn: '2026-11-12',
      payments: [
        { templateId: h.insurance, billMonth: '2026-11', amountMinor: 3_750_000, moneyAccountId: h.card.id, payCardFromFund: true },
        { templateId: 'no-such-bill', billMonth: '2026-11', amountMinor: 1 },
      ],
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(await balances(h)).toEqual(before);
  expect(await listSinkingFunds(h.database.db, h.ws)).toHaveLength(1);
  // And nothing was recorded as settled: the bill can still be paid.
  const ids = await recordBillPayments(h.database, h.ws, { paidOn: '2026-11-12', payments: [{ templateId: h.insurance, billMonth: '2026-11', amountMinor: 3_750_000, moneyAccountId: h.savings.id }] });
  expect(ids).toHaveLength(1);
});

it('a card in another currency than the fund account is refused before anything is posted', async () => {
  const h = await household();
  vi.setSystemTime(new Date('2026-11-12T12:00:00'));
  const usdCard = await createAccount(h.database, h.ws, { name: 'Amex USD', kind: 'liability', subtype: 'credit_card', currency: 'USD' });
  const before = await balances(h);
  await expect(
    recordBillPayments(h.database, h.ws, { paidOn: '2026-11-12', payments: [{ templateId: h.insurance, billMonth: '2026-11', amountMinor: 3_750_000, chargedMinor: 230_000, moneyAccountId: usdCard.id, payCardFromFund: true }] }),
  ).rejects.toMatchObject({ code: 'FUND_CURRENCY' });
  expect(await balances(h)).toEqual(before);
  expect(await listSinkingFunds(h.database.db, h.ws)).toHaveLength(1);
});
