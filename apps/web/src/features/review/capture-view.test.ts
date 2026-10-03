import type { CaptureLine, Reading } from '@expanses/core';
import type { CaptureSource, DraftRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { answerPatch, asksForSourceAccount, captureRowView, draftDays, fieldBoxes, majorText, minorFromTyped } from './capture-view';

const draft = (over: Partial<DraftRow> = {}): DraftRow => ({
  id: 'd1',
  source: 'notification',
  kind: 'expense',
  status: 'pending',
  rawPayload: null,
  occurredOn: '2026-09-30',
  description: 'KOPI KENANGAN',
  amountMinor: 38_000,
  currency: 'IDR',
  accountId: 'bank',
  toAccountId: null,
  categoryAccountId: null,
  cardId: null,
  sourceId: 's1',
  captureIds: ['c1'],
  imageFile: null,
  reading: null,
  mergedInto: null,
  confidence: 90,
  externalRef: null,
  transactionId: null,
  ...over,
});

const source = (over: Partial<CaptureSource> = {}): CaptureSource => ({
  id: 's1',
  keyKind: 'app',
  key: 'com.example.pay',
  label: 'Pay',
  accountId: 'bank',
  workspaceId: 'ws',
  template: null,
  capturedCount: 3,
  ...over,
});

const line = (text: string, y: number, height = 0.03): CaptureLine => ({ text, box: [0.1, y, 0.6, height], height });

const reading: Reading & { lines: CaptureLine[] } = {
  skipped: null,
  amount: { value: { minor: 38_000, currency: 'IDR' }, confidence: 95, line: 2 },
  occurredAt: null,
  type: { value: 'spent', confidence: 80, line: null },
  name: { value: 'TOKO KOPI', confidence: 90, line: 3 },
  accountHint: '1234',
  paymentMethod: null,
  lines: [line('Pay wallet', 0.02), line('Transaksi Berhasil', 0.06), line('Total Rp38.000', 0.5, 0.04), line('Merchant TOKO KOPI', 0.6)],
};

describe('the row a capture sits on', () => {
  it('wears the icon of where it came from', () => {
    const icon = (kind: DraftRow['source']) => captureRowView(draft({ source: kind }), source()).icon;
    expect(icon('notification')).toBe('🔔');
    expect(icon('screen')).toBe('📱');
    expect(icon('photo')).toBe('🧾');
    expect(icon('csv')).toBeNull();
  });

  it('asks a source nobody has answered for which account it is', () => {
    const view = captureRowView(draft({ sourceId: null, accountId: null }), null);
    expect(view.needs).toEqual(['account']);
    expect(view.subtitle).toBe('Captured on this phone');
  });

  it('asks a transfer for the account the money went to', () => {
    const view = captureRowView(draft({ kind: 'transfer', accountId: 'bank', toAccountId: null }), source());
    expect(view.needs).toEqual(['to-account']);
  });

  it('asks for the amount a picture never printed', () => {
    expect(captureRowView(draft({ amountMinor: 0, confidence: null }), source()).needs).toEqual(['amount']);
  });

  it('treats an unsure figure as one still to check', () => {
    expect(captureRowView(draft({ confidence: 40 }), source()).needs).toEqual(['amount']);
  });

  it('says when a draft is more than one sighting', () => {
    const view = captureRowView(draft({ captureIds: ['c1', 'c2'] }), source());
    expect(view.merged).toBe('Seen in 2 captures');
    expect(view.subtitle).toBe('Pay · Seen in 2 captures');

    const alone = captureRowView(draft(), source());
    expect(alone.merged).toBeNull();
    expect(alone.subtitle).toBe('Pay');
  });
});

describe('amounts the owner types', () => {
  it('writes an amount the way it can be typed back', () => {
    expect(majorText(38_000, 'IDR')).toBe('38000');
    expect(majorText(1_250, 'USD')).toBe('12.5');
    expect(majorText(-38_000, 'IDR')).toBe('38000');
  });

  it('reads a typed amount with the reader’s own rules', () => {
    expect(minorFromTyped('38.000', 'IDR')).toBe(38_000);
    expect(minorFromTyped('Rp 38.000', 'IDR')).toBe(38_000);
    expect(minorFromTyped('38000', 'IDR')).toBe(38_000);
    expect(minorFromTyped('12.50', 'USD')).toBe(1_250);
    expect(minorFromTyped('', 'IDR')).toBeNull();
    expect(minorFromTyped('what?', 'IDR')).toBeNull();
  });
});

describe('the boxes over a picture', () => {
  it('places each read field on the line it came from, amount first', () => {
    expect(fieldBoxes(reading)).toEqual([
      { field: 'amount', box: [0.1, 0.5, 0.6, 0.04], label: 'Amount' },
      { field: 'name', box: [0.1, 0.6, 0.6, 0.03], label: 'Merchant' },
    ]);
  });

  it('draws nothing when there are no lines to point at', () => {
    const noLines: Reading = {
      skipped: null,
      amount: { value: { minor: 38_000, currency: 'IDR' }, confidence: 95, line: 2 },
      occurredAt: null,
      type: { value: 'spent', confidence: 80, line: null },
      name: { value: 'TOKO KOPI', confidence: 90, line: 3 },
      accountHint: null,
      paymentMethod: null,
    };
    expect(fieldBoxes(noLines)).toEqual([]);
    expect(fieldBoxes(null)).toEqual([]);
  });
});

describe('the answer to "Which account is this?"', () => {
  const topUpReading: Reading = {
    skipped: null,
    amount: { value: { minor: 200_000, currency: 'IDR' }, confidence: 85, line: null },
    occurredAt: null,
    type: { value: 'topup', confidence: 85, line: null },
    name: null,
    accountHint: null,
    paymentMethod: null,
  };

  it('is where the money left, for a payment', () => {
    const payment = draft({ accountId: null });
    expect(asksForSourceAccount(payment, source({ accountId: null }))).toBe(true);
    expect(answerPatch(payment, 'bank')).toEqual({ accountId: 'bank' });
  });

  it('is where the money landed, for a top-up: the wallet that told us', () => {
    const topUp = draft({ kind: 'transfer', accountId: null, toAccountId: null, amountMinor: -200_000, reading: topUpReading });
    expect(asksForSourceAccount(topUp, source({ accountId: null }))).toBe(true);
    expect(answerPatch(topUp, 'wallet')).toEqual({ toAccountId: 'wallet' });
  });

  it('is not asked of a top-up once it knows where it landed', () => {
    const topUp = draft({ kind: 'transfer', accountId: null, toAccountId: 'wallet', amountMinor: -200_000, reading: topUpReading });
    expect(asksForSourceAccount(topUp, source({ accountId: null }))).toBe(false);
  });

  it('is not asked of a source that has answered', () => {
    expect(asksForSourceAccount(draft({ accountId: null }), source())).toBe(false);
    expect(asksForSourceAccount(draft({ accountId: null }), null)).toBe(false);
  });
});

describe('draftDays', () => {
  it('groups by day, newest first, keeping the queue order inside a day', () => {
    const days = draftDays([
      draft({ id: 'a', occurredOn: '2026-10-02' }),
      draft({ id: 'b', occurredOn: '2026-10-03' }),
      draft({ id: 'c', occurredOn: '2026-10-02' }),
    ]);
    expect(days.map((day) => [day.date, day.drafts.map((d) => d.id)])).toEqual([
      ['2026-10-03', ['b']],
      ['2026-10-02', ['a', 'c']],
    ]);
  });

  it('nets a day as income less what went out, transfers counted as out', () => {
    const [day] = draftDays([
      draft({ id: 'a', amountMinor: 52_000 }),
      draft({ id: 'b', kind: 'transfer', amountMinor: 1_500_000 }),
      draft({ id: 'c', kind: 'income', amountMinor: -100_000 }),
    ]);
    expect(day).toMatchObject({ net: -1_452_000, currency: 'IDR' });
  });

  it('gives no total for a day mixing currencies', () => {
    const [day] = draftDays([draft({ id: 'a' }), draft({ id: 'b', currency: 'USD', amountMinor: 500 })]);
    expect(day!.net).toBe(0);
  });
});
