import { CATALOG } from '@expanses/catalog';
import { parseGroupedMajor } from '@expanses/core';
import type { CardTermsRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { termsFields } from './terms-fields';

const entryFor = (id: string) => {
  const entry = CATALOG.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`The catalogue no longer carries "${id}"`);
  return entry;
};
/** Published at Rp 125.000 a year, for the whole of its life so far. */
const bca = entryFor('bca-unionpay');
const TODAY = '2026-10-24';
const terms = (patch: Partial<CardTermsRow> = {}): CardTermsRow => ({ accountId: 'card', workspaceId: 'ws', statementDay: 25, dueDay: 12, creditLimitMinor: null, annualFeeMinor: null, annualFeeOn: null, annualFeeWaivedYear: null, ...patch });

describe('the card terms form, as it opens', () => {
  it('offers the published fee beside empty days for a catalogue card opened without its dates', () => {
    expect(termsFields(undefined, bca, TODAY, 'IDR')).toEqual({ statementDay: '', dueDay: '', limit: '', fee: '125.000', feeOn: '' });
  });

  it('reads saved terms as saved — an empty fee stays empty, a waived fee is not filled back in', () => {
    expect(termsFields(terms(), bca, TODAY, 'IDR')).toEqual({ statementDay: '25', dueDay: '12', limit: '', fee: '', feeOn: '' });
    expect(termsFields(terms({ annualFeeMinor: 0, creditLimitMinor: 20_000_000 }), bca, TODAY, 'IDR')).toEqual({ statementDay: '25', dueDay: '12', limit: '20.000.000', fee: '0', feeOn: '' });
  });

  it('offers nothing for a card with no entry, an entry with no fee, or a card in another currency', () => {
    expect(termsFields(undefined, null, TODAY, 'IDR').fee).toBe('');
    // The Accor card publishes no fee at all.
    expect(termsFields(undefined, entryFor('cimb-niaga-world-all-accor'), TODAY, 'IDR').fee).toBe('');
    // A rupiah figure is never read as dollars.
    expect(termsFields(undefined, bca, TODAY, 'USD').fee).toBe('');
  });

  it('shows saved figures grouped, cents after a comma, exactly as the amount rows are typed', () => {
    expect(termsFields(terms({ creditLimitMinor: 2_500_000_000, annualFeeMinor: 75_000_000 }), null, TODAY, 'IDR')).toMatchObject({ limit: '2.500.000.000', fee: '75.000.000' });
    expect(termsFields(terms({ creditLimitMinor: 1_234_500, annualFeeMinor: 9_900 }), null, TODAY, 'USD')).toMatchObject({ limit: '12.345,00', fee: '99,00' });
  });

  it('reads back, through the one parser the page saves with, the figure it opened with', () => {
    for (const [currency, limitMinor] of [['IDR', 20_000_000], ['USD', 1_234_567], ['KWD', 1_234_000]] as const) {
      const opened = termsFields(terms({ creditLimitMinor: limitMinor }), null, TODAY, currency);
      expect(parseGroupedMajor(opened.limit, currency)).toBe(limitMinor);
    }
  });
});
