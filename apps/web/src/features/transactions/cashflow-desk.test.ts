import type { TrendBar } from '@expanses/core';
import type { AccountRow, DraftRow } from '@expanses/db';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyBox, MonthBox, RingBox } from './CashflowBoxes';
import { clickAction, countsAs, discardedLine, dayBarsShape, DESK_SORT, monthFigures, NO_SELECTION, orderNote, pageShortcut, peekKey, recordable, recordedToast, recordTickedLabel, ringArcs, ringLegend, type Selection, selectionReducer, skippedLine, sortDesk, tickClick, waitingOrder, waitingSpan } from './cashflow-desk-model';
import type { ListRow } from './list-model';
import { PeekRow } from './ReceiptPeek';
import { kindWord, peekFigure, receiptPeekLines } from './receipt-peek-model';

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
      createElement(RingBox, { kind: 'expense', items, totalMinor: 1_000_000, currency: 'IDR', picked: 'b', onPick: () => {}, icon: (id: string) => createElement('i', { 'data-icon': id }), ready: true, period: 'November 2026' }),
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
    let state = selectionReducer(NO_SELECTION, { type: 'open', id: 't2' });
    expect(state.ids).toEqual(['t2']);
    state = selectionReducer(state, { type: 'step', by: 1, ids });
    expect(state.ids).toEqual(['t3']);
    // At either end it stays where it is.
    expect(selectionReducer(state, { type: 'step', by: 1, ids })).toBe(state);
    state = selectionReducer(state, { type: 'step', by: -1, ids });
    state = selectionReducer(state, { type: 'step', by: -1, ids });
    expect(state.ids).toEqual(['t1']);
    expect(selectionReducer(state, { type: 'step', by: -1, ids })).toBe(state);
    expect(selectionReducer(state, { type: 'close' })).toEqual(NO_SELECTION);
    // Closed, a step does nothing.
    expect(selectionReducer(NO_SELECTION, { type: 'step', by: 1, ids })).toBe(NO_SELECTION);
  });

  it('closes when its row leaves the table (deleted, filtered out)', () => {
    expect(selectionReducer({ ids: ['t2'], anchor: 't2' }, { type: 'listed', ids: ['t1', 't3'] })).toEqual(NO_SELECTION);
    const kept: Selection = { ids: ['t2'], anchor: 't2' };
    expect(selectionReducer(kept, { type: 'listed', ids })).toBe(kept);
  });

  it('Esc closes, ↑ ↓ step and Return edits — never while typing in a field or under a sheet', () => {
    const open = { count: 1, typing: false, covered: false };
    expect(peekKey('Escape', open)).toBe('close');
    expect(peekKey('ArrowUp', open)).toBe('up');
    expect(peekKey('ArrowDown', open)).toBe('down');
    expect(peekKey('Enter', open)).toBe('edit');
    expect(peekKey('a', open)).toBeNull();
    expect(peekKey('Escape', { ...open, typing: true })).toBeNull();
    expect(peekKey('Escape', { ...open, covered: true })).toBeNull();
    expect(peekKey('Escape', { ...open, count: 0 })).toBeNull();
    // Several picked: Esc lets them go; there is no one row to step from or to edit.
    const many = { ...open, count: 3 };
    expect(peekKey('Escape', many)).toBe('close');
    expect(peekKey('ArrowDown', many)).toBeNull();
    expect(peekKey('Enter', many)).toBeNull();
  });

  it('⌘N is a new transaction, ⌘F the search and ⌘A every row, Ctrl too; nothing else', () => {
    const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => pageShortcut({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
    expect(key('n', { metaKey: true })).toBe('new');
    expect(key('f', { metaKey: true })).toBe('search');
    expect(key('F', { ctrlKey: true })).toBe('search');
    expect(key('n')).toBeNull();
    expect(key('n', { metaKey: true, shiftKey: true })).toBeNull();
    expect(key('k', { metaKey: true })).toBeNull();
    expect(key('a', { metaKey: true })).toBe('all');
    expect(key('a')).toBeNull();
  });

  it('the Mac receipt: Category, then every receipt line in the receipt’s order, then its Bill, Paid off, Instalments and Past purchase', () => {
    const lines = [
      { label: 'Paid with', value: 'Kartu Biru ···· 4417' },
      { label: 'Total', value: 'Rp 1.200.000' },
      { label: 'Rate', value: 'Rp 16.050 per US$1', detail: 'Market Rp 16.000' },
      { label: 'Points earned', value: '≈ 120 pts', tone: 'points' as const },
      { label: 'Event', value: 'Trip to Bandung' },
      { label: 'For goal', value: 'New laptop' },
    ];
    const rows = receiptPeekLines({
      category: 'Electronics',
      lines,
      countsAs: 'Lifestyle',
      workspace: 'Household',
      bill: 'None',
      paidOff: { label: 'Paid off', on: false },
      instalments: 'None',
      past: false,
    });
    expect(rows.map((row) => row.label)).toEqual(['Category', 'Paid with', 'Total', 'Rate', 'Points earned', 'Event', 'For goal', 'Counts as', 'Workspace', 'Bill', 'Paid off', 'Instalments']);
    expect(rows.find((row) => row.label === 'Rate')).toMatchObject({ value: 'Rp 16.050 per US$1', detail: 'Market Rp 16.000' });
    expect(rows.find((row) => row.label === 'Points earned')?.tone).toBe('points');
    expect(rows.find((row) => row.label === 'Instalments')).toMatchObject({ action: 'instalments', testId: 'receipt-instalments', tone: 'muted' });
    expect(rows.find((row) => row.label === 'Bill')).toMatchObject({ action: 'bill', testId: 'receipt-bill' });
    // Nothing to say, no row: a receipt with no bill, no switch, no plan and no workspace is its lines alone.
    const bare = receiptPeekLines({ category: 'Transfer', lines: lines.slice(0, 2), countsAs: null, workspace: null, bill: null, paidOff: null, instalments: null, past: true });
    expect(bare.map((row) => row.label)).toEqual(['Category', 'Paid with', 'Total', 'Past purchase']);
    // A plan already made reads as the receipt's Instalments value, not None.
    expect(receiptPeekLines({ category: 'Electronics', lines: [], countsAs: null, workspace: null, bill: null, paidOff: null, instalments: '6 × Rp 200.000', past: false }).at(-1)).toMatchObject({ value: '6 × Rp 200.000' });
  });

  it('the peek’s figure: + and green on money in, a refund included; a transfer unsigned', () => {
    expect(peekFigure({ type: 'expense', amountMinor: 112300, currency: 'IDR' })).toEqual({ text: 'Rp\u00a0112.300', income: false });
    expect(peekFigure({ type: 'expense', amountMinor: -50000, currency: 'IDR' })).toEqual({ text: '+Rp\u00a050.000', income: true });
    expect(peekFigure({ type: 'income', amountMinor: 9000000, currency: 'IDR' }).income).toBe(true);
    expect(peekFigure({ type: 'transfer', amountMinor: 1000000, currency: 'IDR' })).toEqual({ text: 'Rp\u00a01.000.000', income: false });
    expect(kindWord('transfer')).toBe('Transfer');
    expect(kindWord('expense')).toBeNull();
  });

  it('a row the receipt can act on is a button; Paid off a switch; a plain line plain', () => {
    const noop = () => {};
    const instalments = renderToStaticMarkup(createElement(PeekRow, { line: { key: 'i', label: 'Instalments', value: 'None', action: 'instalments', testId: 'receipt-instalments' }, onAction: noop }));
    expect(instalments).toContain('data-testid="receipt-instalments"');
    expect(instalments).toContain('aria-label="Instalments, None"');
    const switchRow = renderToStaticMarkup(createElement(PeekRow, { line: { key: 'p', label: 'Paid off', value: 'On', action: 'paid-off', on: true }, onAction: noop }));
    expect(switchRow).toMatch(/role="switch"[^>]*checked=""/);
    const rate = renderToStaticMarkup(createElement(PeekRow, { line: { key: 'r', label: 'Rate', value: 'Rp 16.050 per US$1', detail: 'Market Rp 16.000' } }));
    expect(rate).toContain('>Rate</dt>');
    expect(rate).toContain('Market Rp 16.000');
    expect(rate).not.toContain('<button');
  });
});

describe('picking several rows, the Mac way', () => {
  const ids = ['t1', 't2', 't3', 't4', 't5'];
  const keys = (held: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) => ({ metaKey: false, ctrlKey: false, shiftKey: false, ...held });
  const click = (state: Selection, id: string, held: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) => selectionReducer(state, clickAction(id, keys(held), ids));

  it('a click picks one row alone; ⌘-click adds a row and takes it out again', () => {
    let state = click(NO_SELECTION, 't2');
    expect(state).toEqual({ ids: ['t2'], anchor: 't2' });
    state = click(state, 't4', { metaKey: true });
    expect(state.ids).toEqual(['t2', 't4']);
    state = click(state, 't1', { ctrlKey: true });
    expect(state.ids).toEqual(['t2', 't4', 't1']);
    state = click(state, 't4', { metaKey: true });
    expect(state).toEqual({ ids: ['t2', 't1'], anchor: 't4' });
    // A plain click among several goes back to the one row.
    expect(click(state, 't5')).toEqual({ ids: ['t5'], anchor: 't5' });
  });

  it('⇧-click picks every row from the anchor to the one clicked, either way, keeping what was picked', () => {
    let state = click(NO_SELECTION, 't2');
    state = click(state, 't4', { shiftKey: true });
    expect(state).toEqual({ ids: ['t2', 't3', 't4'], anchor: 't2' });
    // Upwards from the same anchor, the rows already picked are not picked twice.
    state = click(state, 't1', { shiftKey: true });
    expect(state.ids).toEqual(['t2', 't3', 't4', 't1']);
    // ⌘-click moves the anchor; ⇧-click then reaches from there.
    state = click(click(NO_SELECTION, 't1'), 't4', { metaKey: true });
    expect(click(state, 't5', { shiftKey: true }).ids).toEqual(['t1', 't4', 't5']);
    // With nothing picked yet, ⇧-click picks the row alone.
    expect(click(NO_SELECTION, 't3', { shiftKey: true })).toEqual({ ids: ['t3'], anchor: 't3' });
  });

  it('⌘A picks every row listed, Esc lets them all go', () => {
    const all = selectionReducer(click(NO_SELECTION, 't3'), { type: 'all', ids });
    expect(all).toEqual({ ids, anchor: 't3' });
    expect(selectionReducer(all, { type: 'close' })).toEqual(NO_SELECTION);
    expect(selectionReducer(NO_SELECTION, { type: 'close' })).toBe(NO_SELECTION);
  });

  it('several picked do not step; a row that leaves the table leaves the selection; a bulk action keeps what it left behind', () => {
    const many: Selection = { ids: ['t1', 't3', 't4'], anchor: 't4' };
    expect(selectionReducer(many, { type: 'step', by: 1, ids })).toBe(many);
    expect(selectionReducer(many, { type: 'listed', ids: ['t1', 't2', 't3'] })).toEqual({ ids: ['t1', 't3'], anchor: null });
    expect(selectionReducer(many, { type: 'keep', ids: ['t3'] })).toEqual({ ids: ['t3'], anchor: 't3' });
  });
});

describe('the waiting rows, the typing row and Record', () => {
  const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], currency: string | null): AccountRow => ({
    id, workspaceId: 'ws', parentId: null, kind, subtype, name: id, icon: null, currency, valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2026-11-01T00:00:00Z',
  });
  const accounts = [account('bca', 'asset', 'bank', 'IDR'), account('groceries', 'expense', 'category', null)];
  const draft = (id: string, extra: Partial<DraftRow>): DraftRow => ({
    id, source: 'manual', kind: 'expense', status: 'pending', rawPayload: null, occurredOn: '2026-11-17', description: 'Pasar', amountMinor: 50_000, currency: 'IDR',
    accountId: 'bca', toAccountId: null, categoryAccountId: 'groceries', cardId: null, sourceId: null, captureIds: [], imageFile: null, reading: null, mergedInto: null,
    confidence: null, externalRef: null, transactionId: null, ...extra,
  });

  it('lists the waiting rows in the order they came in, whatever month they are dated in, a paste breaking its own ties', () => {
    const rows = [
      { id: 'z', draft: draft('z', { createdAt: '2026-11-18T09:00:00.002Z', occurredOn: '2026-09-14' }) },
      { id: 'b', draft: draft('b', { createdAt: '2026-11-18T09:00:00.001Z', occurredOn: '2026-11-02' }) },
      { id: 'a', draft: draft('a', { createdAt: '2026-11-18T09:00:00.001Z', occurredOn: '2026-08-01' }) },
      { id: 'old', draft: draft('old', { createdAt: '2026-11-17T08:00:00.000Z', occurredOn: '2026-11-17' }) },
    ];
    // Made first is first; a tie keeps the paste's own order when it is known, else the ids.
    expect(waitingOrder(rows).map((row) => row.id)).toEqual(['old', 'a', 'b', 'z']);
    expect(waitingOrder(rows, ['b', 'a', 'z']).map((row) => row.id)).toEqual(['old', 'b', 'a', 'z']);
  });

  it('records those of several picked that can be, in the table’s order: a blank category is no reason to skip one', () => {
    const waiting = [
      draft('a', {}),
      draft('b', { categoryAccountId: null }),
      draft('c', { amountMinor: 0 }),
      draft('d', {}),
      draft('e', { accountId: null }),
      draft('f', { occurredOn: 'soon' }),
      draft('g', { description: '', categoryAccountId: null }),
    ].map((d) => ({ id: d.id, draft: d }));
    const { ready, skipped } = recordable(['d', 'b', 'a', 'c', 'e', 'f', 'g'], waiting, accounts, '2026-11-18', 'IDR');
    // b (no category) and g (no note, no category) are recorded, under Uncategorised; c, e and f lack an amount, Paid
    // with and a date.
    expect(ready.map((row) => row.id)).toEqual(['a', 'b', 'd', 'g']);
    expect(skipped).toBe(3);
    // A picked recorded row is no waiting row: neither recorded here nor skipped.
    expect(recordable(['a', 'tx1'], waiting, accounts, '2026-11-18', 'IDR')).toMatchObject({ skipped: 0 });
    expect(skippedLine(1)).toBe('1 missing a date, amount or Paid with is skipped');
    expect(skippedLine(2)).toBe('2 missing a date, amount or Paid with are skipped');
  });

  it('Record all is every waiting row that can be recorded, and says how many stay', () => {
    const waiting = [draft('a', {}), draft('b', { categoryAccountId: null }), draft('c', { accountId: null }), draft('d', { occurredOn: '2026-08-30' })].map((d) => ({ id: d.id, draft: d }));
    const all = recordable(waiting.map((row) => row.id), waiting, accounts, '2026-11-18', 'IDR');
    expect(all.ready.map((row) => row.id)).toEqual(['a', 'b', 'd']);
    expect(all.skipped).toBe(1);
    expect(recordable([], waiting, accounts, '2026-11-18', 'IDR')).toEqual({ ready: [], skipped: 0 });
  });

  it('a click on a waiting row, then ⇧-click on another, picks every row between them; ⌘-click still toggles one', () => {
    const ids = ['t1', 't2', 'w1', 'w2', 'w3', 'w4', 'w5'];
    // A recorded row's peek was open; a plain click on the first waiting row (to type in it) lets it go and anchors there.
    let state = selectionReducer({ ids: ['t2'], anchor: 't2' }, { type: 'anchor', id: 'w1' });
    expect(state).toEqual({ ids: [], anchor: 'w1' });
    expect(selectionReducer(state, { type: 'anchor', id: 'w1' })).toBe(state);
    state = selectionReducer(state, clickAction('w4', { metaKey: false, ctrlKey: false, shiftKey: true }, ids));
    expect(state.ids).toEqual(['w1', 'w2', 'w3', 'w4']);
    // Upwards just the same.
    expect(selectionReducer({ ids: [], anchor: 'w5' }, clickAction('w2', { metaKey: false, ctrlKey: false, shiftKey: true }, ids)).ids).toEqual(['w2', 'w3', 'w4', 'w5']);
    state = selectionReducer(state, clickAction('w2', { metaKey: true, ctrlKey: false, shiftKey: false }, ids));
    expect(state.ids).toEqual(['w1', 'w3', 'w4']);
    // With nothing clicked yet, ⇧-click picks that row alone.
    expect(selectionReducer(NO_SELECTION, clickAction('w3', { metaKey: false, ctrlKey: false, shiftKey: true }, ids))).toEqual({ ids: ['w3'], anchor: 'w3' });
  });

  it('says the waiting rows picked and the days they span', () => {
    expect(waitingSpan(['2026-09-12', '2026-08-01', '2026-09-08'])).toBe('3 waiting rows · 1 Aug – 12 Sep 2026');
    expect(waitingSpan(['2026-09-12'])).toBe('1 waiting row · 12 Sep 2026');
    expect(waitingSpan(['2026-01-03', '2025-12-28'])).toBe('2 waiting rows · 28 Dec 2025 – 3 Jan 2026');
    expect(waitingSpan(['2026-09-12', 'soon'])).toBe('2 waiting rows · 12 Sep 2026');
    expect(waitingSpan(['soon'])).toBe('1 waiting row');
  });

  it('says where recorded rows went, by month, and Show › opens the latest', () => {
    expect(recordedToast(['2026-09'])).toEqual({ text: 'Recorded in September 2026', show: '2026-09' });
    expect(recordedToast(['2026-09', '2026-08', '2026-09'])).toEqual({ text: 'Recorded 3 in August and September 2026', show: '2026-09' });
    expect(recordedToast(['2026-09', '2026-07', '2026-08'])).toEqual({ text: 'Recorded 3 in July, August and September 2026', show: '2026-09' });
    expect(recordedToast(['2026-01', '2025-12'])).toEqual({ text: 'Recorded 2 in December 2025 and January 2026', show: '2026-01' });
    expect(recordedToast([])).toBeNull();
  });

  it('several rows recorded say how many, and those left waiting only when there are some', () => {
    expect(recordedToast(['2026-09', '2026-08', '2026-09'], 0)).toEqual({ text: 'Recorded 3 in August and September 2026', show: '2026-09' });
    expect(recordedToast(['2026-09', '2026-08'], 1)).toEqual({ text: 'Recorded 2 in August and September 2026 · 1 skipped', show: '2026-09' });
    expect(recordedToast(['2026-09'], 2)?.text).toBe('Recorded in September 2026 · 2 skipped');
  });

  it('reads oldest at the top, the row typed last at the bottom, as newest first turned round whole', () => {
    const tx = (id: string, date: string, createdAt: string) => ({ id, kind: 'tx', date, amountMinor: 1, tx: { createdAt, dayOrder: null } }) as unknown as ListRow;
    const rows = [tx('b', '2026-11-17', '2026-11-17T08:00:00Z'), tx('a', '2026-11-01', '2026-11-01T08:00:00Z'), tx('c', '2026-11-17', '2026-11-17T09:00:00Z')];
    expect(sortDesk(rows, DESK_SORT).map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(sortDesk(rows, { key: 'date', dir: 'desc' }).map((row) => row.id)).toEqual(['c', 'b', 'a']);
  });

  it('reads oldest at the top by default, and says so in the box header', () => {
    expect(DESK_SORT).toEqual({ key: 'date', dir: 'asc' });
    expect(orderNote(DESK_SORT)).toBe('oldest at the top · new rows at the bottom');
    expect(orderNote({ key: 'date', dir: 'desc' })).toBe('newest at the top · new rows at the bottom');
    expect(orderNote({ key: 'amount', dir: 'desc' })).toBe('largest at the top · new rows at the bottom');
  });
});

describe('the waiting rows’ circles (option A, owner 2026-11-21)', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  // c misses its Paid with: it takes no tick.
  const ready = new Set(['a', 'b', 'd', 'e']);
  const click = (unticked: Set<string>, id: string, anchor: string | null = null, shift = false) => tickClick(unticked, { order, ready, anchor, id, shift });

  it('starts every row that can be recorded ticked; a click turns its own circle and nothing else', () => {
    expect([...click(new Set(), 'b')]).toEqual(['b']);
    expect([...click(new Set(['b']), 'b')]).toEqual([]);
    expect([...click(new Set(), 'c')]).toEqual([]);
  });

  it('⇧-click turns every ready circle from the last one clicked, to what the clicked one becomes, either way round', () => {
    expect([...click(new Set(), 'e', 'a', true)].sort()).toEqual(['a', 'b', 'd', 'e']);
    expect([...click(new Set(['a', 'b', 'd', 'e']), 'b', 'e', true)].sort()).toEqual(['a']);
    // Without an anchor, or without ⇧, only the one clicked.
    expect([...click(new Set(), 'd', null, true)]).toEqual(['d']);
    expect([...click(new Set(), 'd', 'a', false)]).toEqual(['d']);
  });

  it('says the header button and the discard toast', () => {
    expect(recordTickedLabel(0)).toBe('Record');
    expect(recordTickedLabel(3)).toBe('Record 3');
    expect(discardedLine(1)).toBe('Discarded 1 waiting row');
    expect(discardedLine(2)).toBe('Discarded 2 waiting rows');
  });
});
