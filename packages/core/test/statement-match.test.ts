import { describe, expect, it } from 'vitest';
import { type Candidate, looksLikeRefund, matchStatement, type StatementRow } from '../src/index';

const PERIOD = { start: '2026-05-01', end: '2026-05-31' };

function row(on: string, description: string, amountMinor: number, extra: Partial<StatementRow> = {}): StatementRow {
  return { on, postedOn: null, description, amountMinor, direction: 'out', isFee: false, image: 0, ...extra };
}

function cand(id: string, on: string, amountMinor: number, extra: Partial<Candidate> = {}): Candidate {
  return { id, on, amountMinor, direction: 'out', kind: 'purchase', description: 'TOKO', isDraft: false, ...extra };
}

const OFF = { period: PERIOD, trackPayments: false, refundHints: new Map<number, boolean>() };
const ON = { ...OFF, trackPayments: true };

describe('matchStatement', () => {
  it('matches the same amount within three days', () => {
    const result = matchStatement([row('2026-05-10', 'TOKO A', 50_000)], [cand('t1', '2026-05-13', 50_000)], OFF);
    expect(result.outcomes).toEqual([{ row: 0, status: 'matched', candidateIds: ['t1'] }]);
    expect(result.flagged).toEqual([]);
  });

  it('calls a purchase four days away missing', () => {
    const result = matchStatement([row('2026-05-10', 'TOKO A', 50_000)], [cand('t1', '2026-05-14', 50_000)], OFF);
    expect(result.outcomes).toEqual([{ row: 0, status: 'missing', as: 'purchase' }]);
    expect(result.flagged).toEqual(['t1']);
  });

  it('calls an amount within 5% different, and one further off missing', () => {
    const near = matchStatement([row('2026-05-10', 'TOKO A', 126_500)], [cand('t1', '2026-05-10', 126_000)], OFF);
    expect(near.outcomes).toEqual([{ row: 0, status: 'differs', candidateId: 't1', statementMinor: 126_500, recordedMinor: 126_000 }]);
    expect(near.flagged).toEqual([]);

    const far = matchStatement([row('2026-05-10', 'TOKO A', 140_000)], [cand('t1', '2026-05-10', 126_000)], OFF);
    expect(far.outcomes).toEqual([{ row: 0, status: 'missing', as: 'purchase' }]);
    expect(far.flagged).toEqual(['t1']);
  });

  it('leaves untracked card payments aside, matches tracked ones, and sums split payments', () => {
    const cr = row('2026-05-08', 'PAYMENT', 500_000, { direction: 'in' });
    const payment = cand('p1', '2026-05-12', 500_000, { direction: 'in', kind: 'payment' });

    expect(matchStatement([cr], [payment], OFF).outcomes).toEqual([{ row: 0, status: 'payment-untracked' }]);
    expect(matchStatement([cr], [payment], ON).outcomes).toEqual([{ row: 0, status: 'matched', candidateIds: ['p1'] }]);

    const split = matchStatement(
      [row('2026-05-08', 'PAYMENT', 8_786_844, { direction: 'in' }), row('2026-05-08', 'PAYMENT', 240_240, { direction: 'in' })],
      [cand('p9', '2026-05-09', 9_027_084, { direction: 'in', kind: 'payment' })],
      ON,
    );
    expect(split.outcomes).toEqual([
      { row: 0, status: 'matched', candidateIds: ['p9'] },
      { row: 1, status: 'matched', candidateIds: ['p9'] },
    ]);
    expect(split.flagged).toEqual([]);
  });

  it('calls a refund with no recorded refund missing as a refund', () => {
    const result = matchStatement(
      [row('2026-05-08', 'KOPI SENJA', 113_190, { direction: 'in' })],
      [],
      { ...OFF, refundHints: new Map([[0, true]]) },
    );
    expect(result.outcomes).toEqual([{ row: 0, status: 'missing', as: 'refund' }]);
  });

  it('calls a fee with no recorded transaction missing as a fee', () => {
    const result = matchStatement([row('2026-05-20', 'BIAYA MATERAI', 10_000, { isFee: true })], [], OFF);
    expect(result.outcomes).toEqual([{ row: 0, status: 'missing', as: 'fee' }]);
  });

  it('breaks a tie by date, then text, then asks', () => {
    const byDate = matchStatement(
      [row('2026-05-31', 'NOB CAFE', 55_000)],
      [cand('jun2', '2026-06-02', 55_000), cand('may31', '2026-05-31', 55_000)],
      OFF,
    );
    expect(byDate.outcomes).toEqual([{ row: 0, status: 'matched', candidateIds: ['may31'] }]);

    const byText = matchStatement(
      [row('2026-05-31', 'NOB CAFE PLAZA', 55_000)],
      [cand('asa', '2026-06-01', 55_000, { description: 'ASA KIOSK' }), cand('nob', '2026-06-01', 55_000, { description: 'NOB CAFE' })],
      OFF,
    );
    expect(byText.outcomes).toEqual([{ row: 0, status: 'matched', candidateIds: ['nob'] }]);

    const asks = matchStatement(
      [row('2026-05-31', 'NOB CAFE PLAZA', 55_000)],
      [cand('a', '2026-06-01', 55_000, { description: 'NOB CAFE' }), cand('b', '2026-06-01', 55_000, { description: 'NOB CAFE' })],
      OFF,
    );
    expect(asks.outcomes).toEqual([{ row: 0, status: 'ask', candidateIds: ['a', 'b'] }]);
  });

  it('uses a candidate for one row only', () => {
    const result = matchStatement(
      [row('2026-05-10', 'TOKO A', 55_000), row('2026-05-10', 'TOKO A', 55_000)],
      [cand('a', '2026-05-10', 55_000, { description: 'TOKO A' }), cand('b', '2026-05-10', 55_000, { description: 'TOKO A' })],
      OFF,
    );
    expect(result.outcomes.map((o) => o.status)).toEqual(['matched', 'matched']);
    const ids = result.outcomes.map((o) => (o.status === 'matched' ? o.candidateIds : []));
    expect(ids.flat().sort()).toEqual(['a', 'b']);
    expect(result.flagged).toEqual([]);
  });

  it('asks every alike row over the same tied candidates when there are more candidates than rows', () => {
    const result = matchStatement(
      [row('2026-05-10', 'TOKO A', 55_000), row('2026-05-10', 'TOKO A', 55_000)],
      [
        cand('a', '2026-05-10', 55_000, { description: 'TOKO A' }),
        cand('b', '2026-05-10', 55_000, { description: 'TOKO A' }),
        cand('c', '2026-05-10', 55_000, { description: 'TOKO A' }),
      ],
      OFF,
    );
    expect(result.outcomes).toEqual([
      { row: 0, status: 'ask', candidateIds: ['a', 'b', 'c'] },
      { row: 1, status: 'ask', candidateIds: ['a', 'b', 'c'] },
    ]);
    expect(result.flagged).toEqual([]);
  });

  it('keeps candidates a row asks about out of flagged', () => {
    const result = matchStatement(
      [row('2026-05-10', 'TOKO A', 55_000)],
      [cand('a', '2026-05-10', 55_000, { description: 'TOKO A' }), cand('b', '2026-05-10', 55_000, { description: 'TOKO A' })],
      OFF,
    );
    expect(result.outcomes).toEqual([{ row: 0, status: 'ask', candidateIds: ['a', 'b'] }]);
    expect(result.flagged).toEqual([]);
  });

  it('ranks near amounts by the difference first, then the date', () => {
    const result = matchStatement(
      [row('2026-05-10', 'TOKO A', 100_000)],
      [cand('far', '2026-05-10', 96_000), cand('close', '2026-05-11', 99_900)],
      OFF,
    );
    expect(result.outcomes).toEqual([{ row: 0, status: 'differs', candidateId: 'close', statementMinor: 100_000, recordedMinor: 99_900 }]);
    expect(result.flagged).toEqual(['far']);
  });

  it('matches a refund row with a recorded refund', () => {
    const result = matchStatement(
      [row('2026-05-08', 'KOPI SENJA', 113_190, { direction: 'in' })],
      [cand('r1', '2026-05-09', 113_190, { direction: 'in', kind: 'refund' })],
      { ...OFF, refundHints: new Map([[0, true]]) },
    );
    expect(result.outcomes).toEqual([{ row: 0, status: 'matched', candidateIds: ['r1'] }]);
  });

  it('calls a tracked payment with no transfer missing as a payment', () => {
    const result = matchStatement([row('2026-05-08', 'PAYMENT', 500_000, { direction: 'in' })], [], ON);
    expect(result.outcomes).toEqual([{ row: 0, status: 'missing', as: 'payment' }]);
  });

  it('never matches a credit with a purchase draft', () => {
    const result = matchStatement(
      [row('2026-05-08', 'KOPI SENJA', 113_190, { direction: 'in' })],
      [cand('draft:1', '2026-05-08', 113_190, { isDraft: true }), cand('draft:2', '2026-05-08', 113_190, { isDraft: true, direction: 'in' })],
      { ...OFF, refundHints: new Map([[0, true]]) },
    );
    expect(result.outcomes).toEqual([{ row: 0, status: 'missing', as: 'refund' }]);
    expect(result.flagged).toEqual(['draft:1', 'draft:2']);
  });

  it('matches a pending draft like a transaction', () => {
    const result = matchStatement([row('2026-05-10', 'TOKO A', 50_000)], [cand('draft:7', '2026-05-10', 50_000, { isDraft: true })], OFF);
    expect(result.outcomes).toEqual([{ row: 0, status: 'matched', candidateIds: ['draft:7'] }]);
  });

  it('flags a transaction in the period that no row took, not one after the closing date', () => {
    const result = matchStatement(
      [row('2026-05-10', 'TOKO A', 50_000)],
      [cand('t1', '2026-05-10', 50_000), cand('extra', '2026-05-20', 20_000), cand('next', '2026-06-02', 30_000)],
      OFF,
    );
    expect(result.flagged).toEqual(['extra']);
  });
});

describe('looksLikeRefund', () => {
  it('reads a credit from a shop bought from earlier as a refund, a bare number as not', () => {
    const refund = row('2026-05-08', 'KOPI SENJA JAKARTA SLT ID', 113_190, { direction: 'in' });
    expect(looksLikeRefund(refund, [{ description: 'KOPI SENJA JAKARTA SLT ID', amountMinor: 113_190 }])).toBe(true);

    const transfer = row('2026-05-08', '0811000000 JKT ID ID', 500_000, { direction: 'in' });
    expect(looksLikeRefund(transfer, [{ description: 'KOPI SENJA JAKARTA SLT ID', amountMinor: 113_190 }])).toBe(false);
  });

  it('reads a credit equal to an earlier purchase as a refund, whatever its text', () => {
    const credit = row('2026-05-08', '88123 JKT ID', 126_500, { direction: 'in' });
    expect(looksLikeRefund(credit, [{ description: 'KOPI SENJA JAKARTA SLT ID', amountMinor: 126_500 }])).toBe(true);
  });

  it('never reads a row naming a payment as a refund', () => {
    const payment = row('2026-05-08', 'PAYMENT - THANK YOU', 126_500, { direction: 'in' });
    expect(looksLikeRefund(payment, [{ description: 'KOPI SENJA JAKARTA SLT ID', amountMinor: 126_500 }])).toBe(false);
  });

  it('reads a credit naming a shop as a refund with no earlier purchase', () => {
    const credit = row('2026-05-08', 'TOKO SEPATU MAJU', 250_000, { direction: 'in' });
    expect(looksLikeRefund(credit, [])).toBe(true);
  });
});
