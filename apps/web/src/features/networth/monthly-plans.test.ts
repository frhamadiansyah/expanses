import { formatMinor, formatUnits } from '@expanses/core';
import type { TradeTemplateRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { planFigure, planLines, planRowValue } from './monthly-plans';

const plan = (id: string, extra: Partial<TradeTemplateRow> = {}): TradeTemplateRow => ({
  id,
  workspaceId: 'ws',
  accountId: 'fund',
  cashAccountId: 'bank',
  amountMinor: 1_000_000,
  unitsMicro: null,
  dayOfMonth: 5,
  active: true,
  goalId: null,
  kind: 'buy',
  createdAt: '2026-01-01T00:00:00Z',
  ...extra,
});

const names = {
  holding: (accountId: string) => ({ fund: 'Equity fund', gold: 'Gold bar' })[accountId] ?? 'Holding',
  cash: (accountId: string) => ({ bank: 'Bank A', broker: 'Broker cash' })[accountId] ?? 'Account',
  currency: (accountId: string) => (accountId === 'usd' ? 'USD' : 'IDR'),
};

describe('planRowValue', () => {
  it('says None, the one plan’s money and day, or how many', () => {
    expect(planRowValue([], 'IDR')).toBe('None');
    expect(planRowValue([plan('a')], 'IDR')).toBe(`${formatMinor(1_000_000, 'IDR')} · 5th`);
    expect(planRowValue([plan('a'), plan('b', { dayOfMonth: 21 })], 'IDR')).toBe('2 plans');
  });

  it('says a paused plan is paused', () => {
    expect(planRowValue([plan('a', { dayOfMonth: 2, active: false })], 'IDR')).toBe(`${formatMinor(1_000_000, 'IDR')} · 2nd · paused`);
  });
});

describe('planFigure', () => {
  it('reads an older plan kept by units in units', () => {
    expect(planFigure({ amountMinor: null, unitsMicro: 10_500_000 }, 'IDR')).toBe(`${formatUnits(10_500_000)} units`);
  });

  it('reads money in the holding’s currency', () => {
    expect(planFigure({ amountMinor: 25_000, unitsMicro: null }, 'USD')).toBe(formatMinor(25_000, 'USD'));
  });
});

describe('planLines', () => {
  it('makes a plan due once its day has come, in the due tone, from the account it is paid from', () => {
    const [line] = planLines([plan('a')], [], '2026-10-05', names);
    expect(line).toMatchObject({ state: 'due', title: 'Equity fund', subtitle: 'Due on the 5th · from Bank A', tone: 'warn', figure: formatMinor(1_000_000, 'IDR') });
  });

  it('keeps a plan whose day is ahead quiet', () => {
    const [line] = planLines([plan('a', { dayOfMonth: 21 })], [], '2026-10-05', names);
    expect(line).toMatchObject({ state: 'later', subtitle: 'On the 21st · from Bank A', tone: 'ink-3' });
  });

  it('says a plan bought this month was bought, on which day, for what was paid', () => {
    const [line] = planLines([plan('a')], [{ templateId: 'a', occurredOn: '2026-10-03', grossMinor: 1_050_000 }], '2026-10-23', names);
    expect(line).toMatchObject({ state: 'bought', subtitle: 'Bought · 3 Oct', tone: 'gain', figure: formatMinor(1_050_000, 'IDR') });
  });

  it('never makes a paused plan or a monthly move due', () => {
    const lines = planLines(
      [plan('paused', { active: false }), plan('move', { kind: 'move', accountId: 'broker', dayOfMonth: 1 })],
      [],
      '2026-10-23',
      names,
    );
    expect(lines.map((line) => [line.template.id, line.state, line.title, line.subtitle])).toEqual([
      ['move', 'later', 'Move to Broker cash', 'On the 1st · from Bank A'],
      ['paused', 'paused', 'Equity fund', 'Paused · from Bank A'],
    ]);
  });

  it('lists the due ones first, then what is ahead, then what is bought, each by day', () => {
    const lines = planLines(
      [plan('bought', { dayOfMonth: 1 }), plan('later', { dayOfMonth: 25 }), plan('due-late', { dayOfMonth: 10 }), plan('due-early', { dayOfMonth: 2, accountId: 'gold' })],
      [{ templateId: 'bought', occurredOn: '2026-10-01', grossMinor: 1_000_000 }],
      '2026-10-12',
      names,
    );
    expect(lines.map((line) => line.template.id)).toEqual(['due-early', 'due-late', 'later', 'bought']);
  });

  it('reads each plan’s money in its own holding’s currency', () => {
    const [line] = planLines([plan('a', { accountId: 'usd', amountMinor: 25_000 })], [], '2026-10-23', names);
    expect(line!.figure).toBe(formatMinor(25_000, 'USD'));
  });
});
