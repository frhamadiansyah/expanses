import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createAccount,
  listAccounts,
  listSinkingFunds,
  billDetail,
  listTransactions,
  monthlyBills,
  nativeBalances,
  recordBillPayments,
  saveExpenseTemplate,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

// Pay several with one "Paid with" account: every payment names the same moneyAccountId, whatever the bill's own.
let current: TestDb | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T12:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
  current?.executor.close();
  current = undefined;
});

async function setup() {
  current = await setupDb('IDR');
  const { database, ws } = current;
  const open = { kind: 'asset' as const, currency: 'IDR', openedOn: '2026-01-01' };
  const bca = await createAccount(database, ws, { ...open, name: 'BCA Tahapan', subtype: 'bank', openingBalanceMinor: 20_000_000 });
  const jenius = await createAccount(database, ws, { ...open, name: 'Jenius', subtype: 'bank', openingBalanceMinor: 20_000_000 });
  const savings = await createAccount(database, ws, { ...open, name: 'BCA Savings', subtype: 'savings', openingBalanceMinor: 20_000_000 });
  const card = await createAccount(database, ws, { name: 'Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const category = (await listAccounts(database, ws)).find((a) => a.systemKey === 'utilities.internet_provider')!.id;
  const base = { categoryAccountId: category, moneyAccountId: bca.id, startsMonth: '2026-09' };
  const internet = await saveExpenseTemplate(database, ws, { ...base, name: 'Biznet', amountMinor: 450_000, dayOfMonth: 5 });
  const life = await saveExpenseTemplate(database, ws, { ...base, name: 'Life cover', amountMinor: 12_000, dayOfMonth: 5, currency: 'SGD' });
  const insurance = await saveExpenseTemplate(database, ws, {
    ...base,
    name: 'Car insurance',
    dayOfMonth: 12,
    amountMinor: 3_750_000,
    repeat: 'yearly',
    repeatMonth: 11,
    fund: { accountId: savings.id },
  });
  return { database, ws, bca, jenius, savings, card, internet, life, insurance };
}
type H = Awaited<ReturnType<typeof setup>>;

const balances = (h: H) => nativeBalances(h.database, h.ws);

it('one chosen account pays every bill, the SGD one for what it was charged in the account\'s money', async () => {
  const h = await setup();
  const before = await balances(h);
  const ids = await recordBillPayments(h.database, h.ws, {
    paidOn: '2026-11-12',
    payments: [
      { templateId: h.internet, billMonth: '2026-11', amountMinor: 450_000, moneyAccountId: h.jenius.id },
      { templateId: h.life, billMonth: '2026-11', amountMinor: 12_000, chargedMinor: 1_510_000, moneyAccountId: h.jenius.id },
    ],
  });
  expect(ids).toHaveLength(2);
  const after = await balances(h);
  expect((after[h.jenius.id] ?? 0) - (before[h.jenius.id] ?? 0)).toBe(-1_960_000);
  // The bills' own account was not touched.
  expect(after[h.bca.id]).toBe(before[h.bca.id]);
  const txs = await listTransactions(h.database, h.ws, { from: '2026-11-01', to: '2026-11-30' });
  const sgd = txs.find((tx) => tx.originalCurrency === 'SGD')!;
  expect(sgd).toMatchObject({ originalAmountMinor: 12_000 });
  expect(sgd.entries.map((e) => [e.accountId, e.amountMinor])).toContainEqual([h.jenius.id, -1_510_000]);
});

it('a foreign bill paid on the chosen account still wants what was charged', async () => {
  const h = await setup();
  await expect(
    recordBillPayments(h.database, h.ws, { paidOn: '2026-11-12', payments: [{ templateId: h.life, billMonth: '2026-11', amountMinor: 12_000, moneyAccountId: h.jenius.id }] }),
  ).rejects.toMatchObject({ code: 'CHARGED_REQUIRED' });
});

it('on a card for all, only the bill that was saving up pays the card from its fund; the rest stay on the card', async () => {
  const h = await setup();
  const before = await balances(h);
  const ids = await recordBillPayments(h.database, h.ws, {
    paidOn: '2026-11-12',
    payments: [
      { templateId: h.internet, billMonth: '2026-11', amountMinor: 450_000, moneyAccountId: h.card.id, payCardFromFund: false },
      { templateId: h.insurance, billMonth: '2026-11', amountMinor: 3_750_000, moneyAccountId: h.card.id, payCardFromFund: true },
    ],
  });
  // Two purchases and the card payment from the fund.
  expect(ids).toHaveLength(3);
  const after = await balances(h);
  // The card keeps the bill that was not paid from a fund: it owes 450 000 more than before.
  expect((after[h.card.id] ?? 0) - (before[h.card.id] ?? 0)).toBe(-450_000);
  expect((after[h.savings.id] ?? 0) - (before[h.savings.id] ?? 0)).toBe(-3_750_000);
  expect(after[h.bca.id]).toBe(before[h.bca.id]);
  expect(await listSinkingFunds(h.database.db, h.ws)).toEqual([]);
});

it('a paid bill names the account that paid it, not its default', async () => {
  const h = await setup();
  await recordBillPayments(h.database, h.ws, {
    paidOn: '2026-11-12',
    payments: [{ templateId: h.internet, billMonth: '2026-11', amountMinor: 450_000, moneyAccountId: h.card.id }],
  });
  const detail = await billDetail(h.database, h.ws, h.internet, '2026-11-12');
  expect(detail.history.find((row) => row.month === '2026-11')!.paidFromAccountId).toBe(h.card.id);
  const other = (await monthlyBills(h.database, h.ws, '2026-11-12')).find((b) => b.id === h.life)!;
  expect(other.paidFromAccountId).toBeNull();
});
