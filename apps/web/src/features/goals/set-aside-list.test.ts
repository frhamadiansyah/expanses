import { describe, expect, it } from 'vitest';
import { amountNow, canSaveSetAside, currencySign, isOver, type ListAccount, setAsideBar as bar, setAsideLists, stillNeeded, typedMinor, typedText } from './set-aside-list';

// Invented figures: a goal in rupiah, a dollar rate of 15.900.
const RATE = 15_900;
const inGoal = (minor: number, currency: string) => (currency === 'IDR' ? minor : currency === 'USD' ? Math.round((minor / 100) * RATE) : null);
const fromGoal = (minor: number, currency: string) => (currency === 'IDR' ? minor : currency === 'USD' ? Math.round((minor / RATE) * 100) : null);

const account = (id: string, currency = 'IDR', parent: [string, string] | null = null): ListAccount => ({
  id,
  name: parent ? `${parent[1]} · ${currency}` : id,
  currency,
  parentId: parent?.[0] ?? null,
  parentName: parent?.[1] ?? null,
});

describe('setAsideLists', () => {
  const mandiri = account('Mandiri');
  const gopay = account('GoPay');
  const jago = account('Jago');
  const empty = account('Kosong');
  const usd = account('valas-usd', 'USD', ['valas', 'Valas']);
  const idr = account('valas-idr', 'IDR', ['valas', 'Valas']);
  const chf = account('Swiss', 'SGD');
  const held: Record<string, number> = { Mandiri: 15_000_000 };
  const room: Record<string, number> = { Mandiri: 18_000_000, GoPay: 410_000, Jago: 2_640_000, Kosong: 0, 'valas-usd': 33_000, 'valas-idr': 2_050_000, Swiss: 90_000 };
  const lists = setAsideLists([mandiri, gopay, jago, empty, usd, idr, chf], { heldMinor: (id) => held[id] ?? 0, roomMinor: (id) => room[id] ?? 0, inGoal });

  it('puts the accounts holding money for the goal in the first group, even with nothing free', () => {
    const none = setAsideLists([mandiri], { heldMinor: () => 15_000_000, roomMinor: () => 15_000_000, inGoal });
    expect(none.inGoal.map((line) => line.key)).toEqual(['in:Mandiri']);
    expect(none.canAdd).toEqual([]);
    expect(lists.inGoal.map((line) => line.key)).toEqual(['in:Mandiri']);
  });

  it('lists what can add most free first in the goal money, the unrated last, and leaves out an account with nothing free', () => {
    // Valas: US$330 ≈ Rp 5.247.000 + Rp 2.050.000 = Rp 7.297.000, first; Jago, GoPay; Swiss has no rate, last.
    expect(lists.canAdd.map((line) => (line.type === 'parent' ? `parent:${line.name}` : line.type === 'pocket' ? `${line.code}` : line.account.id))).toEqual([
      'parent:Valas',
      'USD',
      'IDR',
      'Jago',
      'GoPay',
      'Swiss',
    ]);
    expect(JSON.stringify(lists)).not.toContain('Kosong');
  });

  it('folds a multicurrency account under its name, its last pocket marked for the tree line, and repeats the name in each group its pockets split into', () => {
    const split = setAsideLists([usd, idr], { heldMinor: (id) => (id === 'valas-usd' ? 20_000 : 0), roomMinor: (id) => room[id] ?? 0, inGoal });
    expect(split.inGoal.map((line) => line.type)).toEqual(['parent', 'pocket']);
    expect(split.canAdd.map((line) => line.type)).toEqual(['parent', 'pocket']);
    const last = split.canAdd[1];
    expect(last?.type === 'pocket' && last.last).toBe(true);
    const pockets = lists.canAdd.filter((line) => line.type === 'pocket');
    expect(pockets.map((line) => line.type === 'pocket' && line.last)).toEqual([false, true]);
  });
});

describe('typing a row', () => {
  it('reads the grouped figure, and nothing from an empty field', () => {
    expect(typedMinor('2.750.000', 'IDR')).toBe(2_750_000);
    expect(typedMinor('200,50', 'USD')).toBe(20_050);
    expect(typedMinor('', 'IDR')).toBeNull();
  });

  it('groups as it goes, and a last dot in a currency with cents is the decimal mark', () => {
    expect(typedText('2750000', 'IDR')).toBe('2.750.000');
    expect(typedText('2.000.', 'USD')).toBe('2.000,');
    expect(typedText('2.000,5', 'USD')).toBe('2.000,5');
    expect(typedText('2.000.', 'IDR')).toBe('2.000');
  });

  it('reads a figure pasted with zero cents into a rupiah row as its whole units', () => {
    expect(typedText('50.000,00', 'IDR')).toBe('50.000');
    expect(typedMinor(typedText('50.000,00', 'IDR'), 'IDR')).toBe(50_000);
    expect(typedText('50.000,00', 'USD')).toBe('50.000,00');
    expect(typedMinor(typedText('50.000,00', 'USD'), 'USD')).toBe(5_000_000);
  });

  it('on an account already short (free below nothing), never calls nothing, a take back or a lower figure over', () => {
    // Holds 15.000.000 for the goal, but the account can now cover only 10.000.000 of it; another goal took more.
    expect(isOver('0', 10_000_000, 15_000_000, 'IDR')).toBe(false);
    expect(isOver('', 10_000_000, 15_000_000, 'IDR')).toBe(false);
    expect(isOver('12.000.000', 10_000_000, 15_000_000, 'IDR')).toBe(false);
    expect(isOver('15.000.000', 10_000_000, 15_000_000, 'IDR')).toBe(false);
    expect(isOver('15.000.001', 10_000_000, 15_000_000, 'IDR')).toBe(true);
    // Free below nothing, nothing held: any figure is over, nothing is not.
    expect(isOver('1', -500_000, 0, 'IDR')).toBe(true);
    expect(isOver('0', -500_000, 0, 'IDR')).toBe(false);
  });

  it('counts what is typed once anything is, else what the goal holds; an emptied row is nothing (a take back)', () => {
    expect(amountNow(undefined, 15_000_000, 'IDR')).toBe(15_000_000);
    expect(amountNow('', 15_000_000, 'IDR')).toBe(0);
    expect(amountNow('1.000', 15_000_000, 'IDR')).toBe(1_000);
  });

  it('is over when the figure is more than the row can hold, and Save waits while any row is', () => {
    expect(isOver('4.000.000', 2_640_000, 0, 'IDR')).toBe(true);
    expect(isOver('2.640.000', 2_640_000, 0, 'IDR')).toBe(false);
    expect(isOver(undefined, 0, 0, 'IDR')).toBe(false);
    expect(canSaveSetAside([{ over: false }, { over: true }])).toBe(false);
    expect(canSaveSetAside([{ over: false }])).toBe(true);
  });

  it('takes what is typed off what the goal still needs, at the day rate, and leaves out a currency with no rate', () => {
    const rows = [
      { amountMinor: 2_640_000, heldMinor: 0, currency: 'IDR' },
      { amountMinor: 0, heldMinor: 1_000_000, currency: 'IDR' },
      { amountMinor: 10_000, heldMinor: 0, currency: 'USD' },
      { amountMinor: 5_000, heldMinor: 0, currency: 'SGD' },
    ];
    expect(stillNeeded(42_100_000, rows, inGoal)).toBe(42_100_000 - 2_640_000 + 1_000_000 - 1_590_000);
    expect(stillNeeded(null, rows, inGoal)).toBeNull();
  });
});

describe('setAsideBar', () => {
  // A figure carries a no-break space after its sign; read here as a plain one.
  const setAsideBar = (p: Parameters<typeof bar>[0]) => JSON.parse(JSON.stringify(bar(p)).replace(/\u00a0/g, ' ')) as ReturnType<typeof bar>;
  const base = { currency: 'IDR', goalCurrency: 'IDR', heldMinor: 0, roomMinor: 2_640_000, typed: undefined as string | undefined, neededMinor: 42_100_000 as number | null, inGoal, fromGoal };

  it('offers a new row all it has free, half of it, and what the goal still needs (information only)', () => {
    const slots = setAsideBar(base);
    expect(slots.map((slot) => [slot.title, slot.detail, slot.fill])).toEqual([
      ['Rp 2.640.000', 'All free', '2.640.000'],
      ['Rp 1.320.000', 'Half', '1.320.000'],
      ['Rp 42.100.000', 'still needed', null],
    ]);
  });

  it('counts the row own figure in still needed as it is typed', () => {
    const slots = setAsideBar({ ...base, typed: '2.640.000' });
    expect(slots[2]?.title).toBe('Rp 39.460.000');
    // The top slot is still the whole of what is free: the cap is what was needed before this row.
    expect(slots[0]?.title).toBe('Rp 2.640.000');
  });

  it('caps the top slot at what fills the goal, and halves that', () => {
    const slots = setAsideBar({ ...base, neededMinor: 1_000_001 });
    expect(slots.map((slot) => [slot.title, slot.detail])).toEqual([
      ['Rp 1.000.001', 'Fills goal'],
      ['Rp 500.000', 'Half'],
      ['Rp 1.000.001', 'still needed'],
    ]);
  });

  it('with no target has no still-needed slot and no cap', () => {
    const slots = setAsideBar({ ...base, neededMinor: null });
    expect(slots.map((slot) => slot.detail)).toEqual(['All free', 'Half']);
  });

  it('in another currency than the goal, says what the row adds in the goal money with ≈, and never with the same currency', () => {
    const slots = setAsideBar({ ...base, currency: 'USD', roomMinor: 33_000, typed: '200' });
    expect(slots.map((slot) => [slot.title, slot.detail])).toEqual([
      ['US$330,00', 'All free'],
      ['US$165,00', 'Half'],
      ['≈ Rp 3.180.000', 'this adds'],
    ]);
    expect(setAsideBar(base).some((slot) => slot.title.includes('≈'))).toBe(false);
    const unrated = setAsideBar({ ...base, currency: 'SGD', roomMinor: 9_000 });
    expect(unrated[2]).toMatchObject({ title: 'No rate yet', fill: null });
  });

  it('caps a foreign row at what the goal needs, in the row own money', () => {
    const slots = setAsideBar({ ...base, currency: 'USD', roomMinor: 33_000, neededMinor: 1_590_000 });
    expect(slots[0]).toMatchObject({ title: 'US$100,00', detail: 'Fills goal', fill: '100,00' });
  });

  it('offers a row already in the goal the most it can hold, Rp 0 to take it back, and what is still needed', () => {
    const slots = setAsideBar({ ...base, heldMinor: 15_000_000, roomMinor: 18_000_000 });
    expect(slots.map((slot) => [slot.title, slot.detail, slot.fill])).toEqual([
      ['Rp 18.000.000', 'Most possible', '18.000.000'],
      ['Rp 0', 'Take back', '0'],
      ['Rp 42.100.000', 'still needed', null],
    ]);
  });

  it('over the limit, is one warn slot that puts in the most the row can hold', () => {
    const slots = setAsideBar({ ...base, typed: '4.000.000' });
    expect(slots).toEqual([{ key: 'only', title: 'Only Rp 2.640.000 free', detail: 'tap to use it', label: 'Use the Rp 2.640.000 free', fill: '2.640.000', warn: true }]);
  });
});

describe('setAsideBar, edges', () => {
  const plain = (slots: ReturnType<typeof bar>) => JSON.parse(JSON.stringify(slots).replace(/\u00a0/g, ' ')) as ReturnType<typeof bar>;
  const base = { currency: 'IDR', goalCurrency: 'IDR', heldMinor: 0, roomMinor: 2_640_000, typed: undefined as string | undefined, neededMinor: 42_100_000 as number | null, inGoal, fromGoal };

  it('offers a row new to a goal already whole nothing to fill: only what is still needed, Rp 0', () => {
    expect(plain(bar({ ...base, neededMinor: 0 })).map((slot) => [slot.title, slot.detail, slot.fill])).toEqual([['Rp 0', 'still needed', null]]);
    expect(plain(bar({ ...base, neededMinor: -3_000_000 })).map((slot) => slot.title)).toEqual(['Rp 0']);
    // Another currency: only what it adds.
    expect(plain(bar({ ...base, currency: 'USD', roomMinor: 33_000, neededMinor: 0 })).map((slot) => slot.detail)).toEqual(['this adds']);
  });

  it('takes back from an over-funded goal without a figure still needed', () => {
    // 5.000.000 more than the goal needs; taking back 3.000.000 of the 15.000.000 held still leaves it whole.
    const slots = plain(bar({ ...base, heldMinor: 15_000_000, roomMinor: 18_000_000, neededMinor: -5_000_000, typed: '12.000.000' }));
    expect(slots[2]).toMatchObject({ title: 'Rp 0', detail: 'still needed' });
    const more = plain(bar({ ...base, heldMinor: 15_000_000, roomMinor: 18_000_000, neededMinor: -5_000_000, typed: '7.000.000' }));
    expect(more[2]).toMatchObject({ title: 'Rp 3.000.000', detail: 'still needed' });
  });

  it('on an account already short, the bar of a lowered row is not the warn slot, and the warn slot fills what is free', () => {
    const lowered = bar({ ...base, heldMinor: 15_000_000, roomMinor: 10_000_000, typed: '12.000.000' });
    expect(lowered.map((slot) => slot.key)).toEqual(['most', 'back', 'needed']);
    const over = bar({ ...base, heldMinor: 15_000_000, roomMinor: 10_000_000, typed: '16.000.000' });
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ key: 'only', fill: '10.000.000', warn: true });
    // What the warn slot puts in is never over.
    expect(isOver(over[0]!.fill!, 10_000_000, 15_000_000, 'IDR')).toBe(false);
    const negative = bar({ ...base, roomMinor: -500_000, typed: '1.000' });
    expect(negative[0]).toMatchObject({ key: 'only', fill: '0' });
    expect(isOver(negative[0]!.fill!, -500_000, 0, 'IDR')).toBe(false);
  });

  it('Save stays open for a take back or a lowered figure on an account already short', () => {
    const rows = [
      { over: isOver('0', 10_000_000, 15_000_000, 'IDR') },
      { over: isOver('12.000.000', 10_000_000, 15_000_000, 'IDR') },
    ];
    expect(canSaveSetAside(rows)).toBe(true);
  });
});

describe('currencySign', () => {
  it('is what a figure carries before its digits, its space included', () => {
    expect(currencySign('IDR')).toBe('Rp\u00a0');
    expect(currencySign('USD')).toBe('US$');
  });
});
