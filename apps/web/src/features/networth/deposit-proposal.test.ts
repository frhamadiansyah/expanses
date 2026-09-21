import { formatMinor } from '@expanses/core';
import type { DepositProposal } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { cardFigures, draftFrom, handEventLabel, interestLine, landsText, newRateText, outcomeLine, proposalHeader, readDraft } from './deposit-proposal';

const idr: DepositProposal = {
  accountId: 'dep', name: 'BCA Deposito', currency: 'IDR',
  event: { kind: 'maturity', dueOn: '2026-10-15', periodFrom: '2026-07-15', days: 92 }, waiting: 0,
  principalMinor: 50_000_000, rateBps: 425, grossMinor: 535_616, taxMinor: 107_123, netMinor: 428_493,
  settings: {
    accountId: 'dep', enabled: true, enabledOn: '2026-07-15', atMaturity: 'principal', interestPaid: 'at_maturity', payoutAccountId: 'bca',
    termMonths: 3, termStartedOn: null, keepRate: true, taxBps: 2_000, taxExempt: false,
  },
};
const usd: DepositProposal = { ...idr, currency: 'USD', principalMinor: 1_000_000, rateBps: 350, grossMinor: 2_972, taxMinor: 594, netMinor: 2_378 };
const taxFree: DepositProposal = { ...idr, taxMinor: 0, netMinor: 535_616, settings: { ...idr.settings, taxExempt: true } };

describe('the draft', () => {
  it('starts from the gross and the tax worked out, in the deposit’s own currency', () => {
    expect(draftFrom(idr)).toEqual({ gross: '535616', tax: '107123', principal: '50000000', rate: '4,25', term: 3 });
    expect(draftFrom(usd)).toMatchObject({ gross: '29.72', tax: '5.94', rate: '3,5' });
  });

  it('leaves the rate empty when the rate is not kept', () => {
    expect(draftFrom({ ...idr, settings: { ...idr.settings, keepRate: false } }).rate).toBe('');
  });

  it('reads the gross and the tax with the app’s one reader, whichever separator', () => {
    expect(readDraft(idr, { ...draftFrom(idr), gross: '535.700', tax: '107.140' })).toMatchObject({ grossMinor: 535_700, taxMinor: 107_140, newRateBps: 425, newTermMonths: 3 });
    expect(readDraft(usd, { ...draftFrom(usd), gross: '29,81' }).grossMinor).toBe(2_981);
    expect(readDraft(usd, { ...draftFrom(usd), gross: '29.81' }).grossMinor).toBe(2_981);
  });

  it('shows what lands as gross minus tax, and nothing it cannot read', () => {
    expect(landsText(idr, { ...draftFrom(idr), gross: '535.700', tax: '107.140' })).toContain('428.560');
    expect(landsText(usd, draftFrom(usd))).toContain('23,78');
    expect(landsText(idr, { ...draftFrom(idr), gross: 'abc' })).toBe('—');
  });

  it('takes no tax from a tax-free deposit, whatever the box says', () => {
    expect(readDraft(taxFree, { ...draftFrom(taxFree), tax: '5' })).toMatchObject({ grossMinor: 535_616, taxMinor: 0 });
  });

  it('refuses a tax larger than the interest, and a new term without its rate', () => {
    expect(() => readDraft(idr, { ...draftFrom(idr), tax: '600.000' })).toThrow('The tax cannot be more than the interest');
    expect(() => readDraft(idr, { ...draftFrom(idr), rate: '' })).toThrow('Type the rate the new term pays');
  });

  it('asks nothing about a new term on a monthly payout, and posts the typed principal only when closing', () => {
    const monthly: DepositProposal = { ...idr, event: { ...idr.event, kind: 'monthly', dueOn: '2026-08-15' } };
    expect(readDraft(monthly, { ...draftFrom(monthly), rate: '' })).toEqual({ grossMinor: 535_616, taxMinor: 107_123, principalMinor: 50_000_000 });
    const closing: DepositProposal = { ...idr, settings: { ...idr.settings, atMaturity: 'close' } };
    expect(readDraft(closing, { ...draftFrom(closing), principal: '49.000.000' })).toEqual({ grossMinor: 535_616, taxMinor: 107_123, principalMinor: 49_000_000 });
  });

  it('prints the new rate as typed, without throwing while it is half-typed', () => {
    expect(newRateText('4,25')).toBe('4,25%');
    expect(newRateText('')).toBe('Type it');
    // parseRate reads "4," as 4 (checked 2026-09-21), so a trailing separator already prints as a rate.
    expect(newRateText('4,')).toBe('4%');
    expect(newRateText('abc')).toBe('abc');
  });
});

describe('what the card says', () => {
  it('names the event and the day', () => {
    expect(proposalHeader(idr, '2026-10-15')).toBe('Matured today');
    expect(proposalHeader(idr, '2026-10-20')).toBe('Matured 15 Oct 2026');
    expect(proposalHeader({ ...idr, event: { ...idr.event, kind: 'monthly', dueOn: '2026-08-15' } }, '2026-10-15')).toBe('Interest due 15 Aug 2026');
  });

  it('says the interest that lands after its tax, or tax-free', () => {
    // The figure is the net, 428 493: not the gross 535 616, and not a net floored on its own (428 492).
    expect(interestLine(idr)).toBe(`${formatMinor(428_493, 'IDR')} after 20% tax`);
    expect(interestLine(taxFree)).toContain('535.616');
    expect(interestLine(taxFree)).toContain('tax-free');
  });

  it('says where the money goes', () => {
    expect(outcomeLine(idr, 'BCA Tahapan')).toBe('Roll over 3 months · interest to BCA Tahapan');
    expect(outcomeLine({ ...idr, settings: { ...idr.settings, atMaturity: 'principal_interest' } }, null)).toBe('Roll over 3 months · interest stays in the deposit');
    expect(outcomeLine({ ...idr, settings: { ...idr.settings, atMaturity: 'close' } }, 'BCA Tahapan')).toBe('Everything to BCA Tahapan · the deposit closes');
  });
});

describe('the card once the editor is closed', () => {
  it('shows the edited figures that Confirm will post, not the estimate', () => {
    const shown = cardFigures(idr, { ...draftFrom(idr), gross: '535.700', tax: '107.140', term: 6 });
    expect(shown.gross).toBe(formatMinor(535_700, 'IDR'));
    // 535 700 − 107 140 = 428 560: the net of what was typed, not the proposed 428 493.
    expect(shown.interest).toBe(`${formatMinor(428_560, 'IDR')} after tax`);
    expect(shown.principal).toBe(formatMinor(50_000_000, 'IDR'));
    expect(shown.term).toBe(6);
    expect(outcomeLine(idr, 'BCA Tahapan', shown.term)).toBe('Roll over 6 months · interest to BCA Tahapan');
  });

  it('keeps the percentage while the figures are the estimate, and shows a closing principal as typed', () => {
    expect(cardFigures(idr, draftFrom(idr)).interest).toBe(`${formatMinor(428_493, 'IDR')} after 20% tax`);
    const closing: DepositProposal = { ...idr, settings: { ...idr.settings, atMaturity: 'close' } };
    expect(cardFigures(closing, { ...draftFrom(closing), principal: '49.000.000' }).principal).toBe(formatMinor(49_000_000, 'IDR'));
  });

  it('shows a dash, never the estimate, while the draft does not read', () => {
    expect(cardFigures(idr, { ...draftFrom(idr), gross: 'abc' })).toMatchObject({ principal: '—', gross: '—', interest: '—' });
    // A rate that is not kept yet does not blank the figures: the New rate row asks for it.
    expect(cardFigures(idr, { ...draftFrom(idr), rate: '' }).gross).toBe(formatMinor(535_616, 'IDR'));
  });
});

describe('the draft guards', () => {
  it('refuses a figure below zero in words, before the database would', () => {
    expect(() => readDraft(idr, { ...draftFrom(idr), gross: '-5' })).toThrow('Interest cannot be below zero');
    expect(() => readDraft(idr, { ...draftFrom(idr), tax: '-5' })).toThrow('Interest cannot be below zero');
  });

  it('refuses a close that says nothing, or less than nothing, came back', () => {
    const closing: DepositProposal = { ...idr, settings: { ...idr.settings, atMaturity: 'close' } };
    expect(() => readDraft(closing, { ...draftFrom(closing), principal: '0' })).toThrow('Say how much came back');
    expect(() => readDraft(closing, { ...draftFrom(closing), principal: '-1' })).toThrow('Say how much came back');
  });
});

describe('an event recorded by hand, on its undo row', () => {
  it('names the event, its day and what the owner said landed', () => {
    const row = { id: 'e', dueOn: '2026-08-15', grossMinor: 180_500, taxMinor: 36_100, netMinor: 144_400 };
    expect(handEventLabel({ ...row, kind: 'monthly' }, 'IDR')).toBe(`Interest due 15 Aug 2026 · ${formatMinor(144_400, 'IDR')}`);
    expect(handEventLabel({ ...row, kind: 'maturity', dueOn: '2026-10-15' }, 'USD')).toBe(`Matured 15 Oct 2026 · ${formatMinor(144_400, 'USD')}`);
  });
});
