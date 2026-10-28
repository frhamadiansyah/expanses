import { currencyInfo } from '../money/currencies';
import { MoneyError } from '../money/money';
import type { Redemption } from './recommend';

/**
 * What a point is worth, to show "≈ money" next to a balance.
 *
 * A programme can carry one value per point, in the workspace's base currency (0105). A single point is worth less than
 * one minor unit often enough (Rp 0,5; $0.0125) that it is kept scaled: minor units times 10 000 per point, an integer.
 * Rp 110 per point is 1 100 000; Rp 0,5 is 5 000.
 */
export const VALUE_PER_POINT_SCALE = 10_000;

export interface PointsWorth {
  valueMinor: number;
  currency: string;
}

/**
 * A count of points in money. The programme's own value per point wins when set; otherwise the best redemption option
 * of the card is the fallback, so a card whose terms list a cash value still shows one. Neither gives null. The result
 * is floored to a whole minor unit, as it always was.
 */
export function pointsWorth(points: number, valuePerPointScaled: number | null, best: Redemption | null, baseCurrency: string): PointsWorth | null {
  if (valuePerPointScaled !== null && valuePerPointScaled > 0) {
    return { valueMinor: Math.floor((points * valuePerPointScaled) / VALUE_PER_POINT_SCALE), currency: baseCurrency };
  }
  if (best && best.perPoints > 0) return { valueMinor: Math.floor((points * best.valueMinor) / best.perPoints), currency: best.currency };
  return null;
}

/**
 * The redemption a card is compared by, where an option is wanted rather than a sum: the programme's value per point as
 * one option when set, else the best option the card lists. Same rule as `pointsWorth`.
 */
export function comparisonRedemption(valuePerPointScaled: number | null, best: Redemption | null, baseCurrency: string): Redemption | null {
  if (valuePerPointScaled !== null && valuePerPointScaled > 0) {
    return { perPoints: VALUE_PER_POINT_SCALE, valueMinor: valuePerPointScaled, currency: baseCurrency };
  }
  return best;
}

/**
 * A typed value per point ("110", "0,5", "1.250,75") as the scaled integer. A separator followed by exactly three
 * digits after a non-zero whole part is thousands ("1.250"); anything else after the last separator is decimals. Finer
 * than the currency's minor unit by four places is accepted; finer still is refused.
 */
export function parseValuePerPoint(text: string, currency: string): number {
  const { exponent } = currencyInfo(currency);
  const typed = text.trim().replace(/[\s_]/g, '');
  if (!/^[0-9.,]+$/.test(typed) || !/[0-9]/.test(typed)) throw new MoneyError(`Invalid amount: "${text}"`);
  const places = exponent + 4;
  const last = Math.max(typed.lastIndexOf('.'), typed.lastIndexOf(','));
  let whole = typed;
  let fraction = '';
  if (last >= 0) {
    const head = typed.slice(0, last);
    const tail = typed.slice(last + 1);
    const thousands = tail.length === 3 && /[1-9]/.test(head.replace(/[.,]/g, ''));
    if (!thousands) {
      whole = head;
      fraction = tail;
    }
  }
  whole = whole.replace(/[.,]/g, '') || '0';
  if (fraction.length > places) {
    if (/[^0]/.test(fraction.slice(places))) throw new MoneyError(`Too many decimal places: "${text}"`);
    fraction = fraction.slice(0, places);
  }
  // Major units × 10^exponent minor × 10^4 scale = 10^places.
  const scaled = Number(whole) * 10 ** places + Number(fraction.padEnd(places, '0') || '0');
  if (!Number.isSafeInteger(scaled)) throw new MoneyError(`Invalid amount: "${text}"`);
  return scaled;
}

/** The scaled value as money, as many decimals as it has and no more than the currency shows: "Rp 110", "Rp 0,5". */
export function formatValuePerPoint(scaled: number, currency: string, locale = 'id-ID'): string {
  const { exponent } = currencyInfo(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent + 4,
  }).format(scaled / (VALUE_PER_POINT_SCALE * 10 ** exponent));
}

/** A value per point as it is being typed, grouped in id-ID as it goes: digits with a dot every three and one decimal comma. */
export function groupTypedValue(typed: string, currency: string): string {
  const { exponent } = currencyInfo(currency);
  const comma = typed.indexOf(',');
  const whole = (comma >= 0 ? typed.slice(0, comma) : typed).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (comma < 0) return grouped;
  return `${grouped || '0'},${typed.slice(comma + 1).replace(/\D/g, '').slice(0, exponent + 4)}`;
}

/** The scaled value as the field shows it: "110", "0,5", "1.250". */
export function valuePerPointText(scaled: number, currency: string): string {
  const places = currencyInfo(currency).exponent + 4;
  const digits = String(scaled).padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const fraction = digits.slice(digits.length - places).replace(/0+$/, '');
  return groupTypedValue(fraction ? `${whole},${fraction}` : whole, currency);
}
