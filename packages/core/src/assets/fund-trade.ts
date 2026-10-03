import { currencyInfo } from '../money/currencies';
import { divRound, formatUnits, PRICE_SCALE, UNITS_SCALE, unitsValueMinor } from './units';

/*
 * A buy or a sell of a mutual fund (reksadana) by amount, the way a fund app takes one: money in or out, and the units
 * it comes to at the NAV. Pure arithmetic; the trade itself is recorded as any other (recordTrade), with no fee.
 */

/** A fund's units are written to four decimal places, as the fund's registrar writes them. */
export const FUND_UNIT_DECIMALS = 4;

/** One ten-thousandth of a unit, in the millionths units are stored in: units round to a multiple of this. */
const UNIT_STEP_MICRO = 10 ** (6 - FUND_UNIT_DECIMALS);

/**
 * Units an amount comes to at a NAV: amount ÷ NAV, to four decimal places, a half rounded up. Worked in whole
 * numbers throughout: the amount in minor units, the NAV in millionths of one, the units back in millionths (always a
 * multiple of 100). Rp 1.000.000 at 1.843,2715 is 542,5137.
 */
export function fundUnitsMicro(amountMinor: number, priceMicro: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new RangeError('An amount is a whole number of minor units, zero or more');
  if (!Number.isSafeInteger(priceMicro) || priceMicro <= 0) throw new RangeError('A NAV is above zero');
  // units × 10⁴ = amount × PRICE_SCALE × 10⁴ ÷ priceMicro
  const tenThousandths = divRound(BigInt(amountMinor) * BigInt(PRICE_SCALE) * BigInt(UNITS_SCALE / UNIT_STEP_MICRO), BigInt(priceMicro));
  const unitsMicro = Number(tenThousandths) * UNIT_STEP_MICRO;
  if (!Number.isSafeInteger(unitsMicro)) throw new RangeError('That is too many units');
  return unitsMicro;
}

export interface FundTrade {
  unitsMicro: number;
  /** What changed hands, in minor units: the amount typed, or on a sell of All the units at the NAV. */
  grossMinor: number;
}

/** A buy of a typed amount; null until there is an amount above zero and a NAV. */
export function fundBuy(o: { amountMinor: number | null; priceMicro: number | null }): FundTrade | null {
  if (!o.amountMinor || o.amountMinor <= 0 || !o.priceMicro || o.priceMicro <= 0) return null;
  const unitsMicro = fundUnitsMicro(o.amountMinor, o.priceMicro);
  return unitsMicro > 0 ? { unitsMicro, grossMinor: o.amountMinor } : null;
}

export interface FundSell extends FundTrade {
  /** The units come to more than is held: refused. */
  tooMany: boolean;
}

/**
 * A sell of a typed amount, or of everything held. All sells every unit exactly — so the holding ends at zero — and
 * is worth the units at the NAV, to the minor unit. A typed amount whose units come to more than is held is refused
 * (`tooMany`). Null until there is an amount (or All), a NAV and something held.
 */
export function fundSell(o: { amountMinor: number | null; all: boolean; priceMicro: number | null; heldMicro: number }): FundSell | null {
  if (!o.priceMicro || o.priceMicro <= 0 || o.heldMicro <= 0) return null;
  if (o.all) return { unitsMicro: o.heldMicro, grossMinor: unitsValueMinor(o.heldMicro, o.priceMicro), tooMany: false };
  if (!o.amountMinor || o.amountMinor <= 0) return null;
  const unitsMicro = fundUnitsMicro(o.amountMinor, o.priceMicro);
  if (unitsMicro <= 0) return null;
  return { unitsMicro, grossMinor: o.amountMinor, tooMany: unitsMicro > o.heldMicro };
}

/** Units as a fund writes them: at least four decimal places, id-ID — 542,5137, 1.356,2481, 10,0000. */
export function fundUnitsText(unitsMicro: number): string {
  const text = formatUnits(unitsMicro);
  const [whole, fraction = ''] = text.split(',');
  return `${whole},${fraction.padEnd(FUND_UNIT_DECIMALS, '0')}`;
}

/** A NAV per unit as a fund writes it: at least four decimal places, id-ID — 1.843,2715. */
export function fundNavText(priceMicro: number, currency: string): string {
  const { exponent } = currencyInfo(currency);
  const major = Number(divRound(BigInt(priceMicro), BigInt(10 ** exponent)));
  return fundUnitsText(major);
}

/**
 * A money amount as it is being typed, grouped in id-ID as it goes: digits, a dot every three, and — for a currency
 * with cents — one decimal comma with no more digits after it than the currency has. "1000000" is "1.000.000".
 */
export function groupTypedAmount(typed: string, currency: string): string {
  const { exponent } = currencyInfo(currency);
  const comma = exponent > 0 ? typed.indexOf(',') : -1;
  const whole = (comma >= 0 ? typed.slice(0, comma) : typed).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (comma < 0) return grouped;
  const cents = typed.slice(comma + 1).replace(/\D/g, '').slice(0, exponent);
  return `${grouped || '0'},${cents}`;
}
