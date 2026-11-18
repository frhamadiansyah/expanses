import type { SharedEventView, SharedExpenseView, SharedPersonView } from '@expanses/db';
import { EXCHANGE_LOSS_KEY } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import {
  barPercent,
  beforeItStarts,
  eventGroups,
  monthsUntil,
  paidWithRows,
  paymentsLine,
  planItemStatus,
  planLine,
  readPlanned,
  sharedChip,
  splitCostsBox,
  startsAhead,
  titleMenu,
  untilWords,
} from './events-desk-model';

/* Invented events: none of these names, dates or figures are anyone's. */
const event = (id: string, name: string, startsOn: string, endsOn: string, finishedAt: string | null = null) => ({ id, name, startsOn, endsOn, finishedAt });
const TODAY = '2026-11-18';
// listEvents' order: by start.
const EVENTS = [
  event('lake', 'Lake house week', '2026-10-24', '2026-10-31'),
  event('coast', 'Coast weekend', '2026-11-01', '2026-11-30', '2026-11-10T09:00:00Z'),
  event('fair', 'Book fair', '2026-11-15', '2026-11-20'),
  event('dinner', 'Office dinner', '2027-01-06', '2027-01-06'),
  event('baby', 'Newborn', '2027-01-11', '2027-04-11'),
];

describe('eventGroups', () => {
  it('keeps the phone list’s rule: running and ahead by start, then the past, most recent first (a finished one is past)', () => {
    const { now, past } = eventGroups(EVENTS, TODAY);
    expect(now.map((e) => e.id)).toEqual(['fair', 'dinner', 'baby']);
    expect(past.map((e) => e.id)).toEqual(['coast', 'lake']);
  });

  it('an event ending today is still running', () => {
    expect(eventGroups([event('x', 'X', '2026-11-10', TODAY)], TODAY).now).toHaveLength(1);
  });
});

describe('titleMenu', () => {
  it('lists Now and next then Past with each first day, the open one ticked; an empty list is left out', () => {
    const menu = titleMenu(EVENTS, TODAY, 'coast');
    expect(menu.map((section) => section.title)).toEqual(['Now and next', 'Past']);
    expect(menu[0]!.rows.map((row) => [row.name, row.when, row.current])).toEqual([
      ['Book fair', '15 Nov', false],
      ['Office dinner', '6 Jan', false],
      ['Newborn', '11 Jan', false],
    ]);
    expect(menu[1]!.rows.map((row) => [row.name, row.when, row.current])).toEqual([
      ['Coast weekend', '1 Nov', true],
      ['Lake house week', '24 Oct', false],
    ]);
    expect(titleMenu([EVENTS[4]!], TODAY, 'baby').map((section) => section.title)).toEqual(['Now and next']);
  });
});

describe('sharedChip', () => {
  it('names the others, two at most, and says Shared alone before anyone is in it', () => {
    expect(sharedChip(undefined)).toBe('Shared');
    expect(sharedChip({ people: [] })).toBe('Shared');
    expect(sharedChip({ people: [{ name: 'Rina', initials: 'R' }] })).toBe('Shared · Rina');
    expect(sharedChip({ people: [{ name: 'Rina', initials: 'R' }, { name: 'Budi', initials: 'B' }] })).toBe('Shared · Rina, Budi');
    expect(sharedChip({ people: ['Rina', 'Budi', 'Sari'].map((name) => ({ name, initials: name[0]! })) })).toBe('Shared · Rina +2');
  });
});

describe('Before it starts', () => {
  it('counts whole months until the start, one at the least', () => {
    expect(monthsUntil('2026-11-18', '2027-01-18')).toBe(2);
    expect(monthsUntil('2026-11-18', '2027-01-17')).toBe(1);
    expect(monthsUntil('2026-11-18', '2027-01-11')).toBe(1);
    expect(monthsUntil('2026-11-18', '2026-12-01')).toBe(1);
    expect(monthsUntil('2026-11-18', '2026-11-19')).toBe(1);
    expect(monthsUntil('2026-11-18', '2027-11-18')).toBe(12);
    expect(monthsUntil('2026-01-31', '2026-03-01')).toBe(1);
  });

  it('a month until then is what is still to pay over those months, rounded up to a whole rupiah', () => {
    // Rp 8.900.000 over 2 months: Rp 4.450.000 each.
    expect(beforeItStarts({ toPayMinor: 8_900_000, startsOn: '2027-01-18', today: TODAY, currency: 'IDR' })).toEqual({ toPayMinor: 8_900_000, months: 2, aMonthMinor: 4_450_000, until: '8 weeks' });
    // Rp 10.000.000 over 3 months: 3.333.333,33… rounds up to Rp 3.333.334, so three months never fall short.
    const three = beforeItStarts({ toPayMinor: 10_000_000, startsOn: '2027-02-18', today: TODAY, currency: 'IDR' });
    expect(three.months).toBe(3);
    expect(three.aMonthMinor).toBe(3_333_334);
    expect(three.aMonthMinor * three.months).toBeGreaterThanOrEqual(10_000_000);
    // Less than a month away is still one month: all of it now.
    expect(beforeItStarts({ toPayMinor: 1_250_001, startsOn: '2026-11-25', today: TODAY, currency: 'IDR' }).aMonthMinor).toBe(1_250_001);
    // Nothing to pay is nothing a month; a negative figure never reaches the box.
    expect(beforeItStarts({ toPayMinor: 0, startsOn: '2027-01-18', today: TODAY, currency: 'IDR' }).aMonthMinor).toBe(0);
    expect(beforeItStarts({ toPayMinor: -5, startsOn: '2027-01-18', today: TODAY, currency: 'IDR' }).toPayMinor).toBe(0);
  });

  it('rounds up to a whole unit of a currency with cents too', () => {
    // USD 1.000,00 over 3 months: 333,33… → 334,00.
    expect(beforeItStarts({ toPayMinor: 100_000, startsOn: '2027-02-18', today: TODAY, currency: 'USD' }).aMonthMinor).toBe(33_400);
  });

  it('says how long until the start in weeks, or days when under two weeks', () => {
    expect(untilWords(TODAY, '2027-01-13')).toBe('8 weeks');
    expect(untilWords(TODAY, '2026-12-01')).toBe('13 days');
    expect(untilWords(TODAY, '2026-11-19')).toBe('1 day');
  });

  it('is shown only for an event not started and not done', () => {
    expect(startsAhead({ startsOn: '2026-11-19', finishedAt: null }, TODAY)).toBe(true);
    expect(startsAhead({ startsOn: TODAY, finishedAt: null }, TODAY)).toBe(false);
    expect(startsAhead({ startsOn: '2026-12-19', finishedAt: '2026-11-01' }, TODAY)).toBe(false);
  });
});

describe('the Plan table and box', () => {
  it('a cost reads Bought once done, Paying while paid towards, else To buy', () => {
    expect(planItemStatus({ done: true, purchaseCount: 1 })).toBe('Bought');
    expect(planItemStatus({ done: true, purchaseCount: 0 })).toBe('Bought');
    expect(planItemStatus({ done: false, purchaseCount: 2 })).toBe('Paying');
    expect(planItemStatus({ done: false, purchaseCount: 0 })).toBe('To buy');
  });

  it('names one payment by where and when, several by how many', () => {
    expect(paymentsLine({ purchaseCount: 0, description: null, occurredOn: null })).toBe('—');
    expect(paymentsLine({ purchaseCount: 1, description: 'Baby store', occurredOn: '2026-09-18' })).toBe('Baby store · 18 Sep');
    expect(paymentsLine({ purchaseCount: 3, description: 'Clinic', occurredOn: '2026-10-02' })).toBe('3 payments');
  });

  it('says what is still to pay, else what is left of the plan, else how far over', () => {
    expect(planLine({ plannedMinor: 49_890_000, plannedSpentMinor: 12_750_000, toBuyMinor: 37_140_000 })).toEqual({ kind: 'to-pay', minor: 37_140_000 });
    expect(planLine({ plannedMinor: 19_700_000, plannedSpentMinor: 18_145_000, toBuyMinor: 0 })).toEqual({ kind: 'left', minor: 1_555_000 });
    expect(planLine({ plannedMinor: 1_000_000, plannedSpentMinor: 1_200_000, toBuyMinor: 0 })).toEqual({ kind: 'over', minor: 200_000 });
  });

  it('a bar never passes either end, nor divides by nought', () => {
    expect(barPercent(1, 0)).toBe(0);
    expect(barPercent(150, 100)).toBe(100);
    expect(barPercent(-5, 100)).toBe(0);
    expect(barPercent(12_750_000, 49_890_000)).toBe(26);
  });
});

describe('readPlanned', () => {
  it('reads a typed figure in the cost’s currency, dots of thousands or none, a symbol left out; nought or nothing is refused', () => {
    expect(readPlanned('4500000', 'IDR')).toEqual({ minor: 4_500_000 });
    expect(readPlanned('4.500.000', 'IDR')).toEqual({ minor: 4_500_000 });
    expect(readPlanned('Rp 4.500.000', 'IDR')).toEqual({ minor: 4_500_000 });
    expect(readPlanned('48,60', 'SGD')).toEqual({ minor: 4_860 });
    expect(readPlanned('0', 'IDR')).toEqual({ error: 'A planned figure is above nought' });
    expect(readPlanned('', 'IDR')).toEqual({ error: 'Type a figure, or Esc to keep it' });
    expect(readPlanned('lots', 'IDR')).toEqual({ error: 'Type a figure, such as 1.500.000' });
  });
});

describe('paidWithRows', () => {
  it('adds each payment’s spending under what paid for it, largest first, and the total is the rows’ own sum', () => {
    const line = (accountKind: string, accountName: string, amountBaseMinor: number, accountSystemKey: string | null = null) => ({ accountKind, accountName, amountBaseMinor, accountSystemKey });
    const { rows, totalMinor } = paidWithRows([
      { entries: [line('expense', 'Food', 120_000), line('asset', 'Kas Kecil', -120_000)] },
      { entries: [line('expense', 'Hotel', 900_000), line('liability', 'Visa 4417', -900_000)] },
      { entries: [line('expense', 'Food', 80_000), line('asset', 'Kas Kecil', -80_000)] },
      // A refund nets off its account's row.
      { entries: [line('expense', 'Hotel', -100_000), line('liability', 'Visa 4417', 100_000)] },
      // An exchange's gain or loss counts nowhere.
      { entries: [line('expense', 'Exchange loss', 5_000, EXCHANGE_LOSS_KEY), line('asset', 'Kas Kecil', -5_000)] },
    ]);
    expect(rows).toEqual([
      { name: 'Visa 4417', minor: 800_000 },
      { name: 'Kas Kecil', minor: 200_000 },
    ]);
    expect(totalMinor).toBe(1_000_000);
  });
});

describe('splitCostsBox', () => {
  const person = (personId: string, name: string, isMe = false, removed = false): SharedPersonView => ({ personId, name, initials: name[0]!, hasApp: true, isMe, removed, balanceMinor: 0 });
  const expense = (id: string, payer: string, eventAmountMinor: number, split: SharedExpenseView['split'], extra: Partial<SharedExpenseView> = {}) =>
    ({ expenseId: id, payerPersonId: payer, eventAmountMinor, split, voided: false, unreadable: null, ...extra }) as SharedExpenseView;
  const view = (people: SharedPersonView[], expenses: SharedExpenseView[]) =>
    ({ people, expenses, myShareMinor: 9_072_500, myName: 'Andi', me: 'a' }) as Pick<SharedEventView, 'people' | 'expenses' | 'myShareMinor' | 'myName' | 'me'>;
  const half = { mode: 'equal' as const, people: ['a', 'r'] };

  it('adds what each person paid (deleted and unreadable records left out), this phone’s person first, and says Half each for two sharing equally', () => {
    const box = splitCostsBox(
      view(
        [person('r', 'Rina'), person('a', 'Andi', true)],
        [expense('1', 'a', 12_445_000, half), expense('2', 'r', 5_700_000, half), expense('3', 'r', 999, half, { voided: true }), expense('4', 'a', 1, half, { unreadable: 'bad rate' })],
      ),
    );
    expect(box.paidBy.map((row) => [row.name, row.minor, row.isMe])).toEqual([
      ['Andi', 12_445_000, true],
      ['Rina', 5_700_000, false],
    ]);
    expect(box.rule).toBe('Half each');
    expect(box.shareMinor).toBe(9_072_500);
  });

  it('names an equal split of three, and a mixed one by this person’s share; a payer since removed is kept so the rows add up', () => {
    const three = { mode: 'equal' as const, people: ['a', 'r', 'b'] };
    expect(splitCostsBox(view([person('a', 'Andi', true), person('r', 'Rina'), person('b', 'Budi')], [expense('1', 'a', 300, three)])).rule).toBe('Equal · 3 people');
    const mixed = splitCostsBox(
      view([person('a', 'Andi', true), person('r', 'Rina'), person('s', 'Sari', false, true)], [expense('1', 'a', 300, half), expense('2', 's', 200, { mode: 'amounts', shares: [] })]),
    );
    expect(mixed.rule).toBe("Andi's share");
    expect(mixed.paidBy.map((row) => [row.name, row.minor])).toEqual([
      ['Andi', 300],
      ['Rina', 0],
      ['Sari', 200],
    ]);
  });
});
