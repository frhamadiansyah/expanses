import { formatMinor } from '@expanses/core';
import type { AssetValueRow, GoalPlanRow, GoalRow, IdleCashRow, NetWorthPoint, PersonDebtRow, PersonLoanRow, TradeTemplateRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { attentionItems, deltaSince, type LoanAttention, monthsSinceJanuary } from './overview-rows';

const value = (partial: Partial<AssetValueRow> & Pick<AssetValueRow, 'accountId' | 'name' | 'mode'>): AssetValueRow => ({
  valueMinor: 1_000_000,
  costMinor: 1_000_000,
  source: 'ledger',
  asOf: null,
  currency: 'IDR',
  planGroup: 'invest',
  stale: false,
  unitsMicro: null,
  ...partial,
});

const template = (id: string, accountId: string): TradeTemplateRow => ({
  id,
  workspaceId: 'ws',
  accountId,
  cashAccountId: 'bca',
  amountMinor: 2_000_000,
  unitsMicro: null,
  dayOfMonth: 5,
  active: true,
  goalId: null,
  kind: 'buy',
  createdAt: '2026-01-01T00:00:00Z',
});

const point = (month: string, netWorthMinor: number): NetWorthPoint => ({ month, onDate: `${month}-28`, assetsMinor: netWorthMinor, liabilitiesMinor: 0, netWorthMinor });

describe('attentionItems', () => {
  it('says nothing when every value is fresh', () => {
    expect(attentionItems([value({ accountId: 'gold', name: 'Antam gold bars', mode: 'market', unitsMicro: 32_000_000 })], [])).toEqual([]);
  });

  it('names a holding whose price has gone stale, with the date', () => {
    const items = attentionItems([value({ accountId: 'gold', name: 'Antam gold bars', mode: 'market', unitsMicro: 32_000_000, stale: true, source: 'price', asOf: '2026-08-11' })], []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tone: 'warn', action: 'Update', to: '/net-worth/assets' });
    expect(items[0]!.text).toContain('Antam gold bars');
    expect(items[0]!.text).toContain('11 Aug 2026');
  });

  it('says when a holding has no price at all', () => {
    const items = attentionItems([value({ accountId: 'gold', name: 'Antam gold bars', mode: 'market', unitsMicro: 32_000_000, stale: true, source: 'cost' })], []);
    expect(items[0]!.text).toContain('no price yet');
  });

  it('calls a property value an estimate', () => {
    const items = attentionItems([value({ accountId: 'house', name: 'House in Bintaro', mode: 'snapshot', stale: true, source: 'valuation', asOf: '2025-01-15', planGroup: 'use' })], []);
    expect(items[0]!.text).toContain('estimate last updated');
  });

  it('leaves sold holdings alone', () => {
    const items = attentionItems([value({ accountId: 'tlkm', name: 'TLKM shares', mode: 'market', unitsMicro: 0, stale: true, source: 'cost' })], []);
    expect(items).toEqual([]);
  });

  it('lists a monthly buy that is due, by name', () => {
    const items = attentionItems([value({ accountId: 'fund', name: 'Equity fund', mode: 'market', unitsMicro: 1_000_000 })], [template('t1', 'fund')]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tone: 'warn', action: 'Record', to: '/net-worth/trades' });
    expect(items[0]!.text).toContain('Equity fund');
  });

  it('gives every item its own key', () => {
    const items = attentionItems(
      [
        value({ accountId: 'gold', name: 'Antam gold bars', mode: 'market', unitsMicro: 32_000_000, stale: true, source: 'price', asOf: '2026-08-11' }),
        value({ accountId: 'fund', name: 'Equity fund', mode: 'market', unitsMicro: 1_000_000 }),
      ],
      [template('t1', 'fund')],
    );
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });
});

const goalRow = (name: string): GoalRow => ({
  id: 'hajj',
  workspaceId: 'ws',
  name,
  kind: 'hajj',
  rank: 0,
  growthBps: 500,
  returnBps: 600,
  standingMonthlyMinor: 0,
  standingNote: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  stages: [],
});

const goalPlanRow = (partial: Partial<GoalPlanRow> = {}): GoalPlanRow => ({
  goalId: 'hajj',
  currentMinor: 1_000_000,
  totalTargetMinor: 50_000_000,
  stages: [],
  requiredMonthlyMinor: 1_000_000,
  plannedMonthlyMinor: 0,
  status: 'behind',
  shortfallMonthlyMinor: 1_000_000,
  riskWarning: null,
  goal: goalRow('Hajj for two'),
  links: [],
  earmarkWarning: null,
  ...partial,
});

describe('attentionItems with goals', () => {
  it('flags a goal that is behind', () => {
    const items = attentionItems([], [], [goalPlanRow()]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tone: 'warn', action: 'Review', to: '/net-worth/goals' });
    expect(items[0]!.text).toContain('Hajj for two');
  });

  it('says nothing about a goal on track', () => {
    expect(attentionItems([], [], [goalPlanRow({ status: 'on_track', shortfallMonthlyMinor: 0 })])).toEqual([]);
  });

  it('passes on a set-aside amount above the balance', () => {
    const items = attentionItems([], [], [goalPlanRow({ status: 'funded', earmarkWarning: 'You set aside more than BCA Tahapan holds' })]);
    expect(items[0]!.text).toContain('BCA Tahapan');
  });
});

const idle = (partial: Partial<IdleCashRow> = {}): IdleCashRow => ({
  accountId: 'rdn',
  name: 'RDN Stockbit',
  currency: 'IDR',
  planGroup: 'invest',
  amountMinor: 1_011_019,
  since: '2026-10-05',
  ...partial,
});

describe('attentionItems with idle cash', () => {
  it('lists cash waiting at the broker, with the date it arrived', () => {
    const items = attentionItems([], [], [], [idle()]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tone: 'info', action: 'Buy', to: '/net-worth/trades' });
    expect(items[0]!.text).toBe(`${formatMinor(1_011_019, 'IDR')} has been waiting in RDN Stockbit since 5 Oct 2026`);
  });

  it('says nothing about a broker account that holds nothing', () => {
    expect(attentionItems([], [], [], [idle({ amountMinor: 0 })])).toEqual([]);
  });

  it('leaves an everyday bank account alone, since money there is meant to be spent', () => {
    expect(attentionItems([], [], [], [idle({ accountId: 'bca', name: 'BCA Tahapan', planGroup: 'liquid', amountMinor: 50_000_000 })])).toEqual([]);
  });
});

const loan = (partial: Partial<PersonLoanRow> = {}): PersonLoanRow => ({
  accountId: 'andi',
  reason: 'Motorcycle repair',
  openedOn: '2026-08-05',
  originalMinor: 10_000_000,
  balanceMinor: 10_000_000,
  repaidMinor: 0,
  dueOn: '2026-09-18',
  dueState: 'due_soon',
  dueLabel: 'Due in 6 days',
  status: 'open',
  currency: 'IDR',
  ...partial,
});

const debtor = (partial: Partial<PersonDebtRow> = {}): PersonDebtRow => ({
  personName: 'Andi',
  direction: 'lent',
  currency: 'IDR',
  totalMinor: 10_000_000,
  loans: [loan()],
  dueState: 'due_soon',
  ...partial,
});

describe('attentionItems with debts', () => {
  it('names who owes what, and when it is due', () => {
    const items = attentionItems([], [], [], [], [debtor()]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tone: 'warn', action: 'Chase', to: '/net-worth/debts' });
    expect(items[0]!.text).toBe(`Andi owes you ${formatMinor(10_000_000, 'IDR')} · Due in 6 days`);
  });

  it('says how late an overdue loan is', () => {
    const items = attentionItems([], [], [], [], [debtor({ dueState: 'overdue', loans: [loan({ dueState: 'overdue', dueLabel: '11 days overdue' })] })]);
    expect(items[0]!.text).toContain('11 days overdue');
  });

  it('turns it around for money you owe', () => {
    const items = attentionItems([], [], [], [], [debtor({ personName: 'Budi', direction: 'borrowed' })]);
    expect(items[0]!.text).toContain('You owe Budi');
    expect(items[0]).toMatchObject({ action: 'Pay' });
  });

  it('says nothing about a loan due in two months', () => {
    expect(attentionItems([], [], [], [], [debtor({ dueState: 'none', loans: [loan({ dueState: 'none', dueLabel: 'Due 30 Nov 2026' })] })])).toEqual([]);
  });

  it('says nothing about a loan already settled', () => {
    expect(attentionItems([], [], [], [], [debtor({ loans: [loan({ status: 'settled', dueState: 'none', dueLabel: '' })] })])).toEqual([]);
  });
});

const loanRow = (partial: Partial<LoanAttention> = {}): LoanAttention => ({
  accountId: 'kpr',
  lenderName: 'Bank BTN',
  currency: 'IDR',
  paymentDueMinor: null,
  paymentDueOn: null,
  fixedRateEndsOn: null,
  lastInstallmentOf: null,
  ...partial,
});

describe('attentionItems with loans', () => {
  it('names the lender and the amount when a payment is nearly due', () => {
    const items = attentionItems([], [], [], [], [], [loanRow({ paymentDueMinor: 7_099_866, paymentDueOn: '2026-09-25' })]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tone: 'warn', action: 'Record', to: '/net-worth/loans' });
    expect(items[0]!.text).toBe(`Bank BTN wants ${formatMinor(7_099_866, 'IDR')} on 25 Sept 2026`);
  });

  it('says nothing about a loan with no payment coming', () => {
    expect(attentionItems([], [], [], [], [], [loanRow()])).toEqual([]);
  });

  it('warns that a fixed rate is about to end', () => {
    const items = attentionItems([], [], [], [], [], [loanRow({ fixedRateEndsOn: '2026-10-22' })]);

    expect(items[0]!.text).toContain('the fixed rate ends 22 Oct 2026');
    expect(items[0]).toMatchObject({ tone: 'info', to: '/net-worth/loans' });
  });

  it('says when a plan reaches its last instalment', () => {
    const items = attentionItems([], [], [], [], [], [loanRow({ lastInstallmentOf: 'iBox Grand Indonesia' })]);

    expect(items[0]!.text).toBe('iBox Grand Indonesia is on its last instalment this month');
  });

  it('lists each thing that needs doing, with its own key', () => {
    const items = attentionItems([], [], [], [], [], [
      loanRow({ paymentDueMinor: 7_099_866, paymentDueOn: '2026-09-25', fixedRateEndsOn: '2026-10-22', lastInstallmentOf: 'iBox' }),
    ]);

    expect(items).toHaveLength(3);
    expect(new Set(items.map((item) => item.key)).size).toBe(3);
  });
});

describe('deltaSince', () => {
  const points = [point('2026-06', 1_000_000_000), point('2026-07', 1_100_000_000), point('2026-08', 1_150_000_000), point('2026-09', 1_200_000_000)];

  it('measures against the month asked for', () => {
    expect(deltaSince(points, 1)).toBe(50_000_000);
    expect(deltaSince(points, 3)).toBe(200_000_000);
  });

  it('is null when the series does not reach back that far', () => {
    expect(deltaSince(points, 12)).toBeNull();
    expect(deltaSince([], 1)).toBeNull();
  });
});

describe('monthsSinceJanuary', () => {
  it('counts back to January of the last point year', () => {
    const points = ['2026-01', '2026-02', '2026-03'].map((month) => point(month, 1));
    expect(monthsSinceJanuary(points)).toBe(2);
  });

  it('is null when January is not in the series', () => {
    const points = ['2025-11', '2025-12'].map((month) => point(month, 1));
    expect(monthsSinceJanuary(points)).toBeNull();
  });
});
