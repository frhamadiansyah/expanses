import type { ItemSummary } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { memberName, type ReceivedItem } from './joint-rows';
import { itemPage, type PurchaseLine, type TransferIn, sharedItemView, linesPaidFrom, transferLines } from './shared-item';

const card: ReceivedItem = {
  itemId: 'i-visa',
  owner: 'm-rina',
  kind: 'liability',
  subtype: 'credit_card',
  name: 'BCA Visa ···· 1234',
  currency: 'IDR',
  balanceMinor: 3_000_000,
  asOf: '2026-09-20',
  card: { limitMinor: 10_000_000, cycleStart: '2026-09-05', cycleEnd: '2026-10-04' },
  period: { start: '2026-09-05', end: '2026-10-04' },
  openingMinor: 1_000_000,
  householdMinor: 1_500_000,
  otherUseMinor: 500_000,
  transferMinor: 0,
  transfers: [],
  monthEnds: [
    { month: '2026-07', balanceMinor: 800_000 },
    { month: '2026-08', balanceMinor: 1_000_000 },
  ],
  tax: null,
} satisfies ItemSummary & { itemId: string };

const line = (over: Partial<PurchaseLine>): PurchaseLine => ({
  lineageId: 'p',
  transactionId: 't',
  occurredOn: '2026-09-10',
  recordedOn: '2026-09-10',
  description: 'Groceries',
  amountMinor: 300_000,
  currency: 'IDR',
  paidFromItemId: 'i-visa',
  paidFromOwner: 'm-rina',
  paidBy: 'm-andi',
  ...over,
});

describe('linesPaidFrom (spec §8.3 "Lines you can see")', () => {
  it('keeps the Household purchases of the period whose money side is on the item', () => {
    const purchases = [
      line({ lineageId: 'a' }),
      line({ lineageId: 'b', paidFromItemId: 'i-other' }),
      line({ lineageId: 'c', paidFromItemId: null }),
      line({ lineageId: 'd', occurredOn: '2026-09-01' }), // before the cycle
    ];
    expect(linesPaidFrom(purchases, card).map((p) => p.lineageId)).toEqual(['a']);
  });

  it('lists the owner’s own purchase and the partner’s alike, and never one naming the item under another owner', () => {
    const purchases = [
      line({ lineageId: 'andi-paid', paidBy: 'm-andi' }),
      line({ lineageId: 'rina-paid', paidBy: 'm-rina' }),
      // A lineage that names Rina's item as someone else's (a crafted op) is not hers to show.
      line({ lineageId: 'crafted', paidFromOwner: 'm-sari' }),
    ];
    expect(linesPaidFrom(purchases, card).map((p) => p.lineageId)).toEqual(['andi-paid', 'rina-paid']);
  });
});

describe('sharedItemView', () => {
  it('reads balance, other use as one total, details and the card bar', () => {
    const view = sharedItemView(card, [line({})], 'Rina');
    expect(view.balance).toEqual({ minor: 3_000_000, currency: 'IDR' });
    expect(view.otherUse).toMatchObject({ label: "Rina's other use", under: 'total only', credit: false });
    expect(view.otherUse.text).toBe(view.otherUse.text.replace('−', '')); // no minus sign on a charge
    expect(view.details).toEqual({ owner: 'Rina', updated: '2026-09-20', notYet: null });
    expect(view.bar).toEqual({ openingPct: 10, householdPct: 15, otherPct: 5, availableMinor: 7_000_000, limitMinor: 10_000_000 });
    // The chart: the month-ends, then today's balance.
    expect(view.chart.values).toEqual([800_000, 1_000_000, 3_000_000]);
  });

  it('a negative other use reads as a credit, with a minus sign', () => {
    const view = sharedItemView({ ...card, otherUseMinor: -250_000, balanceMinor: 2_250_000 }, [], 'Rina');
    expect(view.otherUse.credit).toBe(true);
    expect(view.otherUse.text.startsWith('−')).toBe(true);
    expect(view.otherUse.text).toContain('250.000');
    expect(view.otherUse.under).toBe('total only · a credit');
  });

  it('a purchase paid from it that is newer than the summary is "not yet on Rina\'s phone", and the bar subtracts it', () => {
    const late = line({ lineageId: 'late', occurredOn: '2026-09-25', recordedOn: '2026-09-25', amountMinor: 1_000_000 });
    const view = sharedItemView(card, [line({}), late], 'Rina');
    expect(view.details.notYet).toBe("1 purchase not yet on Rina's phone");
    expect(view.lines.find((l) => l.lineageId === 'late')?.pending).toBe(true);
    expect(view.lines.find((l) => l.lineageId === 'p')?.pending).toBe(false);
    // available 10 jt − (3 jt + 1 jt waiting) = 6 jt; household share grows by what waits.
    expect(view.bar).toEqual({ openingPct: 10, householdPct: 25, otherPct: 5, availableMinor: 6_000_000, limitMinor: 10_000_000 });
  });

  it('a purchase recorded after the summary counts as waiting even when dated before it', () => {
    const view = sharedItemView(card, [line({ occurredOn: '2026-09-18', recordedOn: '2026-09-21' })], 'Rina');
    expect(view.details.notYet).toBe("1 purchase not yet on Rina's phone");
  });

  it('the owner\'s own purchase received late is not pending: her summary already holds it (finding 3)', () => {
    const hers = line({ lineageId: 'hers', paidBy: 'm-rina', occurredOn: '2026-09-25', recordedOn: '2026-09-25', amountMinor: 1_000_000 });
    const view = sharedItemView(card, [hers], 'Rina');
    expect(view.lines[0]!.pending).toBe(false);
    expect(view.details.notYet).toBeNull();
    expect(view.bar!.availableMinor).toBe(7_000_000);
  });

  it('the chart never draws the summary\'s month twice (finding 7)', () => {
    const view = sharedItemView({ ...card, monthEnds: [...card.monthEnds, { month: '2026-09', balanceMinor: 2_900_000 }] }, [], 'Rina');
    expect(view.chart.months).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(view.chart.values).toEqual([800_000, 1_000_000, 3_000_000]);
  });

  it('an account that is not a card has no bar', () => {
    expect(sharedItemView({ ...card, kind: 'asset', subtype: 'bank', card: null }, [], 'Rina').bar).toBeNull();
  });
});

describe('transferLines (spec §8.3 "Lines you can see", a transfer with you)', () => {
  const bank: ReceivedItem = { ...card, itemId: 'i-bca', kind: 'asset', subtype: 'bank', name: 'BCA Tabungan', card: null, period: { start: '2026-09-01', end: '2026-09-30' } };
  const transfer = (over: Partial<TransferIn>): TransferIn => ({
    transferId: 't1',
    occurredOn: '2026-09-12',
    amountMinor: 5_000_000,
    currency: 'IDR',
    description: null,
    direction: 'out',
    counterpart: { owner: 'm-andi', itemId: 'i-mandiri' },
    counterpartName: 'Mandiri Tabungan',
    void: false,
    ...over,
  });

  it('on an asset reads "To you: Mandiri Tabungan −5.000.000" for money it sent you, and "From you" with a plus for money you sent it', () => {
    const lines = transferLines(
      [transfer({}), transfer({ transferId: 't2', direction: 'in', amountMinor: 1_000_000, occurredOn: '2026-09-15', description: 'Groceries back' })],
      bank,
      'm-andi',
    );
    expect(lines).toEqual([
      { key: 't1', title: 'To me: Mandiri Tabungan', note: null, occurredOn: '2026-09-12', amountMinor: -5_000_000, currency: 'IDR' },
      { key: 't2', title: 'From me: Mandiri Tabungan', note: 'Groceries back', occurredOn: '2026-09-15', amountMinor: 1_000_000, currency: 'IDR' },
    ]);
  });

  it('on a card reads in what it owes, like the purchase rows around it: paid down by you is −, charged to send you money is +', () => {
    const lines = transferLines(
      [transfer({ transferId: 'down', direction: 'in', amountMinor: 1_000_000 }), transfer({ transferId: 'charged', direction: 'out', amountMinor: 200_000 })],
      card,
      'm-andi',
    );
    expect(lines.map((l) => [l.key, l.amountMinor])).toEqual([
      ['charged', 200_000],
      ['down', -1_000_000],
    ]);
  });

  it('shows only transfers with you; the period is the read’s to filter, so none is dropped here', () => {
    const lines = transferLines(
      [
        transfer({ transferId: 'with-sari', counterpart: { owner: 'm-sari', itemId: 'i-sari' }, counterpartName: null }),
        transfer({ transferId: 'august', occurredOn: '2026-08-31' }),
        transfer({ transferId: 'mine' }),
      ],
      bank,
      'm-andi',
    );
    expect(lines.map((l) => l.key)).toEqual(['august', 'mine']);
  });

  it('with no local name for your side it still says who, and sharedItemView carries the lines', () => {
    expect(transferLines([transfer({ counterpartName: null })], bank, 'm-andi')[0]!.title).toBe('To me');
    const view = sharedItemView({ ...bank, transferMinor: -5_000_000 }, [], 'Rina', { transfers: [transfer({})], me: 'm-andi' });
    expect(view.transfers.map((t) => t.title)).toEqual(['To me: Mandiri Tabungan']);
    expect(sharedItemView(bank, [], 'Rina').transfers).toEqual([]);
  });
});

describe('transfers are counted once (wave 4 review, finding 1)', () => {
  const bank: ReceivedItem = { ...card, itemId: 'i-bca', kind: 'asset', subtype: 'bank', name: 'BCA Tabungan', card: null, asOf: '2026-09-20', period: { start: '2026-09-01', end: '2026-09-30' } };
  const mine: TransferIn = {
    transferId: 't1',
    occurredOn: '2026-09-12',
    amountMinor: 5_000_000,
    currency: 'IDR',
    description: null,
    direction: 'out',
    counterpart: { owner: 'm-andi', itemId: 'i-mandiri' },
    counterpartName: 'Mandiri Tabungan',
    void: false,
  };

  it('other use stays other use, and no "Other transfers" row when the listed ones are all of them', () => {
    const view = sharedItemView({ ...bank, otherUseMinor: 300_000, transferMinor: -5_000_000, transfers: [{ transferId: 't1', minor: -5_000_000 }] }, [], 'Rina', {
      transfers: [mine],
      me: 'm-andi',
    });
    expect(view.otherUse.text).not.toContain('5.000.000');
    expect(view.otherTransfers).toBeNull();
  });

  it('three members: a transfer with Sari that the summary counted is the "Other transfers" row, exactly', () => {
    const view = sharedItemView(
      { ...bank, transferMinor: -7_000_000, transfers: [{ transferId: 't1', minor: -5_000_000 }, { transferId: 't-sari', minor: -2_000_000 }] },
      [],
      'Rina',
      { transfers: [mine, { ...mine, transferId: 't-sari', counterpart: { owner: 'm-sari', itemId: 'i-sari' }, counterpartName: null }], me: 'm-andi' },
    );
    expect(view.transfers.map((t) => t.key)).toEqual(['t1']);
    expect(view.otherTransfers).toEqual({ label: 'Other transfers', minor: -2_000_000, currency: 'IDR' });
  });

  it('same-day lag: a transfer dated the summary’s own day that it has not counted yet makes no phantom row', () => {
    const sameDay: TransferIn = { ...mine, transferId: 't-today', occurredOn: bank.asOf };
    const view = sharedItemView({ ...bank, transferMinor: 0, transfers: [] }, [], 'Rina', { transfers: [sameDay], me: 'm-andi' });
    expect(view.transfers).toHaveLength(1);
    expect(view.otherTransfers).toBeNull();
  });

  it('an edit not yet on the owner’s phone (5 jt counted, 4 jt listed now) makes no phantom row; nor does a void one', () => {
    const counted = { ...bank, transferMinor: -5_000_000, transfers: [{ transferId: 't1', minor: -5_000_000 }] };
    expect(sharedItemView(counted, [], 'Rina', { transfers: [{ ...mine, amountMinor: 4_000_000 }], me: 'm-andi' }).otherTransfers).toBeNull();
    // Voided since, not yet on her phone: no row of its own, and not "other" either — it was a transfer with you.
    const view = sharedItemView(counted, [], 'Rina', { transfers: [{ ...mine, void: true }], me: 'm-andi' });
    expect(view.transfers).toEqual([]);
    expect(view.otherTransfers).toBeNull();
  });

  it('with no transfer list to compare against (withYou = null), no "Other transfers" row is claimed (final review item 10)', () => {
    const view = sharedItemView({ ...bank, transferMinor: -5_000_000, transfers: [{ transferId: 't1', minor: -5_000_000 }] }, [], 'Rina');
    expect(view.transfers).toEqual([]);
    expect(view.otherTransfers).toBeNull();
  });

  it('the card bar fills to what is owed: From earlier, Household, other use (final review item 3)', () => {
    const bar = sharedItemView(card, [], 'Rina').bar!;
    // Owes 3 jt of a 10 jt limit: 30% filled, 7 jt available.
    expect(bar.openingPct + bar.householdPct + bar.otherPct).toBe(30);
    expect(bar.availableMinor).toBe(bar.limitMinor - card.balanceMinor);
  });

  it('the card bar reads transfers in its other segment, from the owner’s summary', () => {
    const view = sharedItemView({ ...card, otherUseMinor: 500_000, transferMinor: 1_000_000, balanceMinor: 4_000_000 }, [], 'Rina');
    expect(view.bar).toEqual({ openingPct: 10, householdPct: 15, otherPct: 15, availableMinor: 6_000_000, limitMinor: 10_000_000 });
  });
});

describe('itemPage (finding 3: Accounts → "Andi\'s, shared" → the item, in separate mode)', () => {
  const group = { mode: 'separate' as const, me: 'm-andi', groupBookId: 'g', workspaceBookId: 'w' };

  it('draws the item in separate mode, and goes back to Accounts', () => {
    const page = itemPage({ group, items: [card], names: { 'm-rina': 'Rina' } }, 'i-visa', [], []);
    expect(page.view?.name).toBe('BCA Visa ···· 1234');
    expect(page.view?.details.owner).toBe('Rina');
    expect(page.back).toEqual({ back: 'Accounts', backTo: '/accounts' });
  });

  it('goes back to Net worth in joint mode, and has nothing for an item no longer shared or no group', () => {
    expect(itemPage({ group: { ...group, mode: 'joint' }, items: [card], names: {} }, 'i-visa', [], []).back).toEqual({ back: 'Net worth', backTo: '/net-worth' });
    expect(itemPage({ group, items: [card], names: {} }, 'gone', [], []).view).toBeNull();
    expect(itemPage(null, 'i-visa', [], []).view).toBeNull();
    // An owner the workspace has not named reads as memberName's fallback.
    expect(itemPage({ group, items: [card], names: {} }, 'i-visa', [], []).view?.details.owner).toBe(memberName({}, 'm-rina'));
  });
});
