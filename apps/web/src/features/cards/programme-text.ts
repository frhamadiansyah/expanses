import { convertDetail, type TransferPartner } from '@expanses/core';
import type { Balance } from '@expanses/core';
import type { ProgrammeHistoryRow } from '@expanses/db';
import { formatPoints } from './format-points';

/*
 * The words a points programme is shown with — on the Cards page's Points section and on the programme's own page.
 * Plain functions, so what a row says can be checked without drawing it.
 */

const dayMonth = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** Who fills a programme: the one card earning into it, how many do, or that only conversions do. */
export function earnersLine(earners: readonly { cardName: string }[]): string {
  if (earners.length === 0) return 'No card · converted in';
  if (earners.length === 1) return earners[0]!.cardName;
  return `${earners.length} cards earn here`;
}

/** "3.000 expire 31 Dec": what of the balance dies within the warning window, and when the first of it does. */
export function expiryNote(balance: Pick<Balance, 'expiringSoon' | 'nextExpiryOn'>): string | null {
  if (balance.expiringSoon <= 0 || balance.nextExpiryOn === null) return null;
  return `${formatPoints(balance.expiringSoon)} expire ${dayMonth(balance.nextExpiryOn)}`;
}

/** The programme's balance with its unit: "12.345 miles". */
export const balanceText = (total: number, unit: string) => `${formatPoints(total)} ${unit}`;

/** What one line of a programme's history says: its title, the line under it, and its figure. */
export function historyLine(row: ProgrammeHistoryRow, unit: string): { title: string; subtitle: string; value: string } {
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatPoints(Math.abs(n))}`;
  const on = dayMonth(row.on);
  switch (row.kind) {
    case 'earn':
      return { title: row.label ?? 'Earned', subtitle: `Statement of ${on}${row.estimated ? ' · estimated' : ''}`, value: signed(row.quantity) };
    case 'convert_out': {
      const other = row.counterpart;
      return {
        title: `To ${other?.programmeName ?? 'another programme'}`,
        subtitle: `Converted ${on}`,
        value: other ? `${formatPoints(-row.quantity)} → ${formatPoints(other.quantity)} ${other.unit}` : signed(row.quantity),
      };
    }
    case 'convert_in': {
      const other = row.counterpart;
      return {
        title: `From ${other?.programmeName ?? 'another programme'}`,
        subtitle: `Converted ${on}`,
        value: other ? `${formatPoints(-other.quantity)} → ${formatPoints(row.quantity)} ${unit}` : signed(row.quantity),
      };
    }
    case 'redeem':
      return { title: row.label ?? 'Redeemed', subtitle: `Redeemed ${on}`, value: signed(row.quantity) };
    case 'transfer':
      return { title: row.label ?? 'Moved to a partner', subtitle: `Moved ${on}`, value: signed(row.quantity) };
    case 'adjust':
      return { title: 'Balance set', subtitle: `${row.label ?? 'Balance read'} · ${on}`, value: signed(row.quantity) };
    case 'expire':
      return { title: 'Expired', subtitle: on, value: signed(row.quantity) };
  }
}

/**
 * A count of points as typed: "10.000" and "10000" are ten thousand, as the app writes them, and a comma is the
 * decimal mark ("12,5"). NaN for anything else, so the save can refuse it.
 */
export function parsePoints(text: string): number {
  const typed = text.trim().replace(/\s/g, '');
  if (typed === '') return Number.NaN;
  const whole = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(typed) ? typed.replace(/\./g, '') : typed;
  return Number(whole.replace(',', '.'));
}

/** The partner listing a programme by name, among the partners of the cards earning into the source. */
export function partnerFor(programmeName: string, partners: readonly TransferPartner[]): TransferPartner | undefined {
  const wanted = programmeName.trim().toLowerCase();
  return partners.find((partner) => partner.program.trim().toLowerCase() === wanted);
}

/**
 * What a conversion should bring, at the partner's ratio — whole steps only, nothing under the minimum — and a word on
 * the points that would not move. Null with no partner to go by: what arrived is then typed in, as it always may be.
 */
export function conversionEstimate(points: number, partner: TransferPartner | undefined, unit: string): { received: number; note: string | null } | null {
  if (!partner || !Number.isFinite(points) || points <= 0) return null;
  const detail = convertDetail(points, partner);
  if (detail.units === 0) {
    const minimum = Math.max(partner.minimumPoints ?? 0, partner.incrementPoints);
    return { received: 0, note: `Nothing moves under ${formatPoints(minimum)} ${unit}` };
  }
  const counted = detail.fullRatePoints + detail.beyondPoints;
  return { received: detail.units, note: counted < Math.floor(points) ? `Converts in steps of ${formatPoints(partner.incrementPoints)}: ${formatPoints(counted)} of these ${unit} count` : null };
}
