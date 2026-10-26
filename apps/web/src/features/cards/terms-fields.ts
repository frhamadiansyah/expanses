import { type CatalogEntry, feeOn } from '@expanses/catalog';
import { minorToMajorString } from '@expanses/core';
import type { CardTermsRow } from '@expanses/db';

/** The card terms form's five fields, as text: what it starts from, and what tells it apart once typed in. */
export interface TermsFields {
  statementDay: string;
  dueDay: string;
  limit: string;
  fee: string;
  /** The date the annual fee is charged on, `YYYY-MM-DD`, or empty. */
  feeOn: string;
}

/**
 * What the card terms form opens with: the saved terms, or — for a card with none yet — the fee its catalogue entry
 * publishes.
 *
 * A card can be opened from the catalogue without its billing and due dates, and the published fee is kept on the
 * terms row those dates make, so applying the entry had nowhere to write it. The form fills it in instead, beside
 * the empty days: saving the days saves the fee with them, in sight, and it can be corrected before it is — a fee
 * waived or negotiated down is the holder's to say. Saved terms are always read as saved, an empty fee included.
 */
export function termsFields(terms: CardTermsRow | undefined, entry: CatalogEntry | null | undefined, today: string, currency: string): TermsFields {
  if (terms) {
    return {
      statementDay: String(terms.statementDay),
      dueDay: String(terms.dueDay),
      limit: terms.creditLimitMinor != null ? minorToMajorString(terms.creditLimitMinor, currency) : '',
      fee: terms.annualFeeMinor != null ? minorToMajorString(terms.annualFeeMinor, currency) : '',
      feeOn: terms.annualFeeOn ?? '',
    };
  }
  // The entry's fee is in the entry's currency, which is the card's own for a card it opened; any other is not offered.
  const published = entry && entry.currency === currency ? feeOn(entry, today) : null;
  return { statementDay: '', dueDay: '', limit: '', fee: published ? minorToMajorString(published.annualFeeMinor, currency) : '', feeOn: '' };
}
