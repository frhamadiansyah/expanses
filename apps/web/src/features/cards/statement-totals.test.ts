import type { CardStatement } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { statementTotals } from './statement-totals';

const statement = (over: Partial<CardStatement>): CardStatement =>
  ({
    cycle: { start: '2026-08-21', end: '2026-09-20' },
    currency: 'IDR',
    openingMinor: 0,
    chargesMinor: 0,
    creditsMinor: 0,
    closingMinor: 0,
    lines: [],
    closed: false,
    paidSinceMinor: 0,
    leftToPayMinor: null,
    ...over,
  }) as CardStatement;

describe('what a statement’s totals band draws', () => {
  it('splits an open statement into the previous bill, what is paid of it, and this cycle', () => {
    const t = statementTotals(statement({ openingMinor: 5_230_417, chargesMinor: 5_765_917, creditsMinor: 3_138_000, closingMinor: 7_858_334 }));
    expect(t).toMatchObject({
      closed: false,
      billMinor: 5_230_417,
      paidMinor: 3_138_000,
      leftMinor: 2_092_417,
      unbilledMinor: 5_765_917,
      unbilledLeftMinor: 5_765_917,
      totalMinor: 7_858_334,
      wholeMinor: 10_996_334,
    });
  });

  it('spills a payment bigger than the previous bill into this cycle, and no further', () => {
    const t = statementTotals(statement({ openingMinor: 1_000_000, chargesMinor: 800_000, creditsMinor: 1_300_000, closingMinor: 500_000 }));
    expect(t).toMatchObject({ paidMinor: 1_000_000, leftMinor: 0, unbilledMinor: 800_000, unbilledLeftMinor: 500_000, totalMinor: 500_000 });
  });

  it('keeps the total right when a payment clears everything and leaves change', () => {
    const t = statementTotals(statement({ openingMinor: 1_000_000, chargesMinor: 200_000, creditsMinor: 1_500_000, closingMinor: -300_000 }));
    expect(t).toMatchObject({ paidMinor: 1_000_000, leftMinor: 0, unbilledLeftMinor: 0, totalMinor: 0 });
  });

  it('a closed statement is its bill, what has been paid since, and what is left', () => {
    const t = statementTotals(statement({ closed: true, openingMinor: 0, chargesMinor: 5_230_417, closingMinor: 5_230_417, paidSinceMinor: 3_138_000, leftToPayMinor: 2_092_417 }));
    expect(t).toMatchObject({ closed: true, billMinor: 5_230_417, paidMinor: 3_138_000, leftMinor: 2_092_417, unbilledMinor: 0, totalMinor: 5_230_417, wholeMinor: 5_230_417 });
  });

  it('never pays more of a closed bill than the bill itself', () => {
    const t = statementTotals(statement({ closed: true, chargesMinor: 400_000, closingMinor: 400_000, paidSinceMinor: 900_000, leftToPayMinor: 0 }));
    expect(t).toMatchObject({ paidMinor: 400_000, leftMinor: 0 });
  });

  it('draws nothing at all for a statement that billed nothing', () => {
    const t = statementTotals(statement({ closed: true, closingMinor: 0, leftToPayMinor: 0 }));
    expect(t).toMatchObject({ billMinor: 0, paidMinor: 0, leftMinor: 0, wholeMinor: 0, totalMinor: 0 });
  });

  it('treats a card in credit as owing nothing', () => {
    const t = statementTotals(statement({ openingMinor: -250_000, chargesMinor: 100_000, creditsMinor: 0, closingMinor: -150_000 }));
    expect(t).toMatchObject({ billMinor: 0, paidMinor: 0, leftMinor: 0, unbilledMinor: 100_000, unbilledLeftMinor: 100_000, totalMinor: 100_000 });
  });
});
