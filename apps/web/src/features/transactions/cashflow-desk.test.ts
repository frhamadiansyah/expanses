import type { TrendBar } from '@expanses/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyBox, MonthBox, RingBox } from './CashflowBoxes';
import { countsAs, dayBarsShape, monthFigures, pageShortcut, peekKey, peekReducer, ringArcs, ringLegend } from './cashflow-desk-model';
import { CashflowPeek, type PeekView } from './CashflowPeek';

const colour = (id: string) => `#${id.padStart(6, '0').slice(-6)}`;
const node = (id: string, name: string, totalMinor: number) => ({ id, name, totalMinor });

describe('the ring and its categories', () => {
  it('names the five largest, gathers the rest (and any category set) into Others, and its shares add up to the ring', () => {
    const nodes = [node('a', 'Food & drink', 2000), node('b', 'Groceries', 1800), node('c', 'Transport', 1200), node('d', 'Electronics', 900), node('e', 'Household', 800), node('f', 'Health', 600), node('g', 'Gifts', 500)];
    const { items, wholeMinor } = ringLegend(nodes, colour, 2200);
    expect(items.map((item) => item.name)).toEqual(['Food & drink', 'Groceries', 'Transport', 'Electronics', 'Household', 'Others']);
    expect(wholeMinor).toBe(10000);
    expect(items.map((item) => item.percent)).toEqual([20, 18, 12, 9, 8, 33]);
    // Others filters nothing: it has no category.
    expect(items.at(-1)).toMatchObject({ categoryId: null, minor: 3300 });
    expect(items[0]).toMatchObject({ categoryId: 'a', colour: colour('a') });
  });

  it('draws nothing for a period with nothing in it, and a lone category as the whole ring', () => {
    expect(ringLegend([], colour)).toEqual({ items: [], wholeMinor: 0 });
    expect(ringLegend([node('a', 'Rent', 0)], colour).items).toEqual([]);
    expect(ringLegend([node('a', 'Rent', 500)], colour).items).toEqual([{ key: 'a', categoryId: 'a', name: 'Rent', colour: colour('a'), minor: 500, percent: 100 }]);
  });

  it('lays the arcs end to end round the circle', () => {
    const arcs = ringArcs([{ key: 'a', minor: 300, colour: '#1' }, { key: 'b', minor: 100, colour: '#2' }], 400, 2);
    expect(arcs).toEqual([
      { key: 'a', colour: '#1', dash: 298, offset: -0 },
      { key: 'b', colour: '#2', dash: 98, offset: -300 },
    ]);
    expect(ringArcs([], 400)).toEqual([]);
  });
});

describe('this month', () => {
  it('leaves what came in less what went out, and waits for both', () => {
    expect(monthFigures(21_480_300, 38_000_000, 3)).toEqual({ spentMinor: 21_480_300, receivedMinor: 38_000_000, leftMinor: 16_519_700, toReview: 3 });
    expect(monthFigures(500, 200, 0).leftMinor).toBe(-300);
    expect(monthFigures(null, 200, 0).leftMinor).toBeNull();
  });

  it('draws the four figures, Received in green, Left in red below nought, and To review as given', () => {
    const html = renderToStaticMarkup(createElement(MonthBox, { title: 'This month', figures: monthFigures(500_000, 200_000, 4), currency: 'IDR', review: (count: number) => `${count} waiting` }));
    expect(html).toContain('This month');
    expect(html).toMatch(/data-testid="month-spent"[^>]*>Rp\s500\.000</);
    expect(html).toMatch(/text-\[var\(--ph-up\)\][^>]*>Rp\s200\.000</);
    expect(html).toMatch(/text-\[var\(--ph-alarm\)\][^>]*>-Rp\s300\.000</);
    expect(html).toContain('4 waiting');
  });
});

describe('the boxes as drawn', () => {
  it('the ring box names its categories with their marks and shares, and the one picked reads pressed', () => {
    const { items } = ringLegend([node('a', 'Food & drink', 600), node('b', 'Groceries', 400)], colour);
    const html = renderToStaticMarkup(
      createElement(RingBox, { kind: 'expense', items, totalMinor: 1_000_000, currency: 'IDR', picked: 'b', onPick: () => {}, icon: (id: string) => createElement('i', { 'data-icon': id }), ready: true }),
    );
    expect(html).toContain('Spending by category');
    expect(html).toContain('click to filter');
    expect(html).toContain('data-icon="a"');
    expect(html).toContain('60%');
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*Groceries/);
    expect(html).toMatch(/data-testid="period-total"[^>]*>Rp\s1\.000\.000</);
  });

  it('the day bars stop at today, mark it, and name the first and last day', () => {
    const bar = (day: number, totalMinor: number | null): TrendBar => {
      const iso = `2026-11-${String(day).padStart(2, '0')}`;
      return { from: iso, to: iso, label: iso, tick: String(day), totalMinor, partial: false };
    };
    const bars = Array.from({ length: 30 }, (_, i) => bar(i + 1, i < 17 ? (i + 1) * 1000 : null));
    expect(dayBarsShape(bars, '2026-11-17')).toEqual({ peakMinor: 17_000, todayIndex: 16 });
    expect(dayBarsShape(bars, '2026-12-01').todayIndex).toBe(-1);
    const html = renderToStaticMarkup(createElement(DailyBox, { kind: 'expense', bars, unit: 'day', currency: 'IDR', today: '2026-11-17', note: 'November' }));
    expect(html).toContain('Spent each day');
    expect(html).toContain('Today');
    expect(html).toContain('1 Nov');
    expect(html).toContain('30 Nov');
    // Seventeen days drawn, none for the days to come.
    expect(html.match(/<i class="block w-full/g)).toHaveLength(17);
  });
});

describe('Counts as', () => {
  const needs = { food: 'lifestyle', rent: 'essential', loan: 'debts_savings' } as const;
  it('says what a spending row counts as, a dash for money in, and nothing while the marks are read', () => {
    expect(countsAs({ type: 'expense', categoryId: 'food' }, needs)).toBe('Lifestyle');
    expect(countsAs({ type: 'expense', categoryId: 'rent' }, needs)).toBe('Essential');
    expect(countsAs({ type: 'expense', categoryId: 'loan' }, needs)).toBe('Debts & savings');
    // A category with no mark of its own or inherited counts as essential (`resolveNeeds`).
    expect(countsAs({ type: 'expense', categoryId: 'new' }, needs)).toBe('Essential');
    expect(countsAs({ type: 'income', categoryId: 'salary' }, needs)).toBe('—');
    expect(countsAs({ type: 'expense', categoryId: null }, needs)).toBe('—');
    expect(countsAs({ type: 'expense', categoryId: 'food' }, undefined)).toBe('');
  });
});

describe('the side peek', () => {
  const ids = ['t1', 't2', 't3'];
  it('opens on a row, steps up and down within the table, and closes', () => {
    let state = peekReducer({ id: null }, { type: 'open', id: 't2' });
    expect(state.id).toBe('t2');
    state = peekReducer(state, { type: 'step', by: 1, ids });
    expect(state.id).toBe('t3');
    // At either end it stays where it is.
    expect(peekReducer(state, { type: 'step', by: 1, ids })).toBe(state);
    state = peekReducer(state, { type: 'step', by: -1, ids });
    state = peekReducer(state, { type: 'step', by: -1, ids });
    expect(state.id).toBe('t1');
    expect(peekReducer(state, { type: 'step', by: -1, ids })).toBe(state);
    expect(peekReducer(state, { type: 'close' })).toEqual({ id: null });
    // Closed, a step does nothing.
    expect(peekReducer({ id: null }, { type: 'step', by: 1, ids })).toEqual({ id: null });
  });

  it('closes when its row leaves the table (deleted, filtered out)', () => {
    expect(peekReducer({ id: 't2' }, { type: 'listed', ids: ['t1', 't3'] })).toEqual({ id: null });
    const kept = { id: 't2' };
    expect(peekReducer(kept, { type: 'listed', ids })).toBe(kept);
  });

  it('Esc closes, ↑ ↓ step and Return edits — never while typing in a field or under a sheet', () => {
    const open = { open: true, typing: false, covered: false };
    expect(peekKey('Escape', open)).toBe('close');
    expect(peekKey('ArrowUp', open)).toBe('up');
    expect(peekKey('ArrowDown', open)).toBe('down');
    expect(peekKey('Enter', open)).toBe('edit');
    expect(peekKey('a', open)).toBeNull();
    expect(peekKey('Escape', { ...open, typing: true })).toBeNull();
    expect(peekKey('Escape', { ...open, covered: true })).toBeNull();
    expect(peekKey('Escape', { ...open, open: false })).toBeNull();
  });

  it('⌘N is a new transaction and ⌘F the search, Ctrl too; nothing else', () => {
    const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => pageShortcut({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
    expect(key('n', { metaKey: true })).toBe('new');
    expect(key('f', { metaKey: true })).toBe('search');
    expect(key('F', { ctrlKey: true })).toBe('search');
    expect(key('n')).toBeNull();
    expect(key('n', { metaKey: true, shiftKey: true })).toBeNull();
    expect(key('k', { metaKey: true })).toBeNull();
  });

  it('draws the title, amount, date, its lines and Edit · Split · Delete, with ⌃ ⌄ off at the ends', () => {
    const view: PeekView = {
      id: 't2',
      title: 'Superindo',
      amount: 'Rp 112.300',
      income: false,
      date: 'Wed 11 Nov 2026',
      rows: [
        { label: 'Category', value: 'Groceries' },
        { label: 'Paid with', value: 'Cash' },
        { label: 'Counts as', value: 'Essential', tone: 'muted' },
        { label: 'Workspace', value: 'Household' },
        { label: 'Event', value: 'None', tone: 'muted' },
        { label: 'Receipt', value: 'No photo · Add', tone: 'muted' },
        { label: 'Points', value: '+11 pts', tone: 'up' },
      ],
      canEdit: true,
      canSplit: true,
      canDelete: true,
    };
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(CashflowPeek, { view, first: true, last: false, busy: false, onStep: noop, onClose: noop, onEdit: noop, onSplit: noop, onDelete: noop }));
    expect(html).toContain('aria-label="Transaction details"');
    expect(html).toContain('Superindo');
    expect(html).toContain('Rp 112.300');
    expect(html).toContain('Wed 11 Nov 2026');
    for (const label of ['Category', 'Paid with', 'Counts as', 'Workspace', 'Event', 'Receipt', 'Points']) expect(html).toContain(`>${label}</dt>`);
    expect(html).toMatch(/aria-label="Previous transaction"[^>]*disabled=""/);
    expect(html).not.toMatch(/aria-label="Next transaction"[^>]*disabled=""/);
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('>Edit</button>');
    expect(html).toContain('>Split</button>');
    expect(html).toContain('aria-label="Delete this transaction"');
    // A row that cannot be changed here offers neither Edit nor Split, and no Delete at all.
    const locked = renderToStaticMarkup(createElement(CashflowPeek, { view: { ...view, canEdit: false, canSplit: false, canDelete: false }, first: false, last: true, busy: false, onStep: noop, onClose: noop, onEdit: noop, onSplit: noop, onDelete: noop }));
    expect(locked).toMatch(/disabled=""[^>]*>Edit</);
    expect(locked).not.toContain('Delete this transaction');
    expect(locked).toMatch(/aria-label="Next transaction"[^>]*disabled=""/);
  });
});
