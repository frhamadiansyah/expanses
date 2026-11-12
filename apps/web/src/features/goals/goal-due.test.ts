import { formatMinor } from '@expanses/core';
import type { GoalDue, GoalDueMonth, GoalDueSettings } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { DUE_DAYS, dueDayLabel, dueDefaults, dueSheetFooter, dueTitle, dueToast, goalsThisMonth, monthHistory, monthlyFooter, monthlySubtitle, toDefault } from './goal-due';

// Invented names and figures.
const rp = (minor: number) => formatMinor(minor, 'IDR');

const settings = (over: Partial<GoalDueSettings> = {}): GoalDueSettings => ({
  goalId: 'umrah',
  day: 20,
  mode: 'set_aside',
  accountId: 'giro',
  toAccountId: null,
  startedMonth: '2026-09',
  active: true,
  ...over,
});

const month = (over: Partial<GoalDueMonth> = {}): GoalDueMonth => ({
  goalId: 'umrah',
  month: '2026-11',
  dueOn: '2026-11-20',
  state: 'open',
  mode: 'set_aside',
  amountMinor: 1_700_000,
  occurredOn: null,
  accountId: 'giro',
  toAccountId: null,
  transactionId: null,
  ...over,
});

const names: Record<string, string> = { giro: 'Sejahtera Giro', tabungan: 'Sejahtera Tabungan' };
const nameOf = (id: string | null) => (id ? (names[id] ?? 'Account') : 'Account');

describe('the day picker', () => {
  it('offers the 1st to the 28th, then Last day', () => {
    expect(DUE_DAYS).toHaveLength(29);
    expect(DUE_DAYS[0]).toEqual({ value: 1, label: '1st' });
    expect(DUE_DAYS[24]).toEqual({ value: 25, label: '25th' });
    expect(DUE_DAYS[28]).toEqual({ value: 31, label: 'Last day' });
    expect(dueDayLabel(22)).toBe('22nd');
    expect(dueDayLabel(30)).toBe('Last day');
  });
});

describe('what Due each month starts on', () => {
  const accounts = [
    { id: 'giro', subtype: 'bank' },
    { id: 'tabungan', subtype: 'savings' },
    { id: 'cash', subtype: 'cash' },
  ];

  it('the 1st, the account the goal already sets aside in, and a savings account to transfer to', () => {
    expect(dueDefaults(accounts, ['cash'])).toEqual({ day: 1, accountId: 'cash', toAccountId: 'tabungan' });
    expect(dueDefaults(accounts, [])).toEqual({ day: 1, accountId: 'giro', toAccountId: 'tabungan' });
  });

  it('To is never From', () => {
    expect(toDefault(accounts, 'tabungan')).toBe('giro');
    expect(toDefault([{ id: 'giro', subtype: 'bank' }], 'giro')).toBeNull();
  });
});

describe('the Monthly sheet footer', () => {
  it('reads as the mockup, with the real day and account', () => {
    expect(monthlyFooter({ day: 25, mode: 'set_aside', goalName: 'Umrah', inName: 'Sejahtera Giro', toName: null })).toBe(
      'Comes due on the 25th, like a bill. Set aside keeps the money in Sejahtera Giro, promised to Umrah; Transfer moves it to another account.',
    );
  });

  it('names the destination of a Transfer goal, and the last day', () => {
    expect(monthlyFooter({ day: 31, mode: 'transfer', goalName: 'Umrah', inName: 'Sejahtera Giro', toName: 'Sejahtera Tabungan' })).toBe(
      'Comes due on the last day, like a bill. Set aside keeps the money in Sejahtera Giro, promised to Umrah; Transfer moves it to Sejahtera Tabungan.',
    );
  });
});

describe('the goal page Monthly row', () => {
  it('says the day and where the money goes', () => {
    expect(monthlySubtitle(settings({ day: 25 }), nameOf)).toBe('Due on the 25th · Set aside in Sejahtera Giro');
    expect(monthlySubtitle(settings({ day: 1, mode: 'transfer', toAccountId: 'tabungan' }), nameOf)).toBe('Due on the 1st · Transfer to Sejahtera Tabungan');
  });

  it('says nothing while off', () => {
    expect(monthlySubtitle(settings({ active: false }), nameOf)).toBeNull();
    expect(monthlySubtitle(null, nameOf)).toBeNull();
  });
});

describe('the month’s words', () => {
  it('titles and Undo bars', () => {
    expect(dueTitle('Umrah', '2026-11')).toBe('Umrah · November');
    expect(dueToast('set_aside', 'Umrah', '2026-11')).toBe('Set aside for Umrah · November');
    expect(dueToast('transfer', 'Umrah', '2026-11')).toBe('Transferred for Umrah · November');
    expect(dueToast('skipped', 'Umrah', '2026-11')).toBe('Skipped Umrah · November');
  });

  it('the sheet footer', () => {
    expect(dueSheetFooter({ mode: 'set_aside', amountText: rp(1_700_000), goalName: 'Umrah', fromName: 'Sejahtera Giro', toName: '' })).toBe(
      `Nothing leaves the account: ${rp(1_700_000)} moves from Free to spend to Set aside for Umrah.`,
    );
    expect(dueSheetFooter({ mode: 'transfer', amountText: rp(1_700_000), goalName: 'Umrah', fromName: 'Sejahtera Giro', toName: 'Sejahtera Tabungan' })).toBe(
      `${rp(1_700_000)} moves from Sejahtera Giro to Sejahtera Tabungan, for Umrah.`,
    );
  });
});

describe('Recurring: Goals this month', () => {
  const goals = [
    { goalId: 'umrah', name: 'Umrah', kind: 'umrah', currency: 'IDR' },
    { goalId: 'school', name: 'Sekolah anak', kind: 'education', currency: 'IDR' },
    { goalId: 'laptop', name: 'New laptop', kind: 'other', currency: 'IDR' },
    { goalId: 'house', name: 'House', kind: 'home', currency: 'IDR' },
  ];
  const dues: GoalDue[] = [
    { settings: settings(), months: [month(), month({ month: '2026-10', dueOn: '2026-10-20' })] },
    {
      settings: settings({ goalId: 'school', mode: 'transfer', toAccountId: 'tabungan', day: 1 }),
      months: [month({ goalId: 'school', dueOn: '2026-11-01', state: 'done', mode: 'transfer', amountMinor: 900_000, occurredOn: '2026-11-02', toAccountId: 'tabungan' })],
    },
    { settings: settings({ goalId: 'laptop', day: 10 }), months: [month({ goalId: 'laptop', dueOn: '2026-11-10', state: 'skipped', amountMinor: 450_000 })] },
    // Turned off with only an old month left: nothing due this month.
    { settings: settings({ goalId: 'house', active: false }), months: [month({ goalId: 'house', month: '2026-08', state: 'done' })] },
  ];

  it('one row per goal due this month, with its button or its state', () => {
    const { lines } = goalsThisMonth(dues, goals, '2026-11-12');
    expect(lines.map((line) => [line.name, line.subtitle, line.action, line.status])).toEqual([
      ['Umrah', `20 Nov · ${rp(1_700_000)}`, 'Set aside', null],
      ['Sekolah anak', `1 Nov · ${rp(900_000)}`, null, '✓ Transferred'],
      ['New laptop', `10 Nov · ${rp(450_000)}`, null, 'Skipped'],
    ]);
  });

  it('a Transfer goal’s open month has Transfer; a done set-aside says so', () => {
    const transfer: GoalDue[] = [{ settings: settings({ mode: 'transfer', toAccountId: 'tabungan' }), months: [month({ mode: 'transfer' })] }];
    expect(goalsThisMonth(transfer, goals, '2026-11-12').lines[0]!.action).toBe('Transfer');
    const done: GoalDue[] = [{ settings: settings(), months: [month({ state: 'done', occurredOn: '2026-11-12' })] }];
    expect(goalsThisMonth(done, goals, '2026-11-12').lines[0]!.status).toBe('✓ Set aside');
  });

  it('totals every row of the month, as the mockup', () => {
    expect(goalsThisMonth(dues, goals, '2026-11-12').totals).toEqual([{ currency: 'IDR', amountMinor: 3_050_000 }]);
  });

  it('is empty when no goal is due, so the group hides', () => {
    expect(goalsThisMonth(dues, goals, '2026-12-01').lines).toEqual([]);
    expect(goalsThisMonth([], goals, '2026-11-12')).toEqual({ lines: [], totals: [] });
  });
});

describe('Month history', () => {
  it('says what each month was, newest first', () => {
    const lines = monthHistory(
      [
        month({ state: 'done', occurredOn: '2026-11-21' }),
        month({ month: '2026-10', state: 'skipped' }),
        month({ month: '2026-09', state: 'done', mode: 'transfer', amountMinor: 2_000_000, occurredOn: '2026-09-26', toAccountId: 'tabungan' }),
        month({ month: '2025-12', state: 'open' }),
      ],
      'IDR',
      nameOf,
      '2026-11-12',
    );
    expect(lines.map((line) => [line.title, line.subtitle, line.value])).toEqual([
      ['November', 'Set aside 21 Nov · Sejahtera Giro', rp(1_700_000)],
      ['October', 'Skipped', '—'],
      ['September', 'Transferred 26 Sep · Sejahtera Tabungan', rp(2_000_000)],
      ['December 2025', 'Open', rp(1_700_000)],
    ]);
  });
});
