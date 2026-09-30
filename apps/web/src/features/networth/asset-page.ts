import { currencyInfo, formatMinor, formatPriceMicro, formatUnits, PRICE_SCALE, priceMicroFrom, type UnitKind, unitsValueMinor, type ValuationBasis } from '@expanses/core';

/**
 * What an asset's own page says, worked out apart from the page: the gain beside the figure, the line under it, the
 * four labelled figures, and each purchase's own gain. Pure, so the page draws what these decide and a test can hold
 * each wording down.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "30 Sep 2026" — spelled here rather than by the browser, whose en-GB has taken to writing "Sept". */
export function dayLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day || month > 12) return iso;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

const signed = (minor: number, currency: string) => `${minor < 0 ? '−' : '+'}${formatMinor(Math.abs(minor), currency)}`;

/** A share of something, to one decimal, with its sign: "+9,9%", "−36,4%". */
export function percentLabel(part: number, whole: number): string {
  const percent = (part / whole) * 100;
  const text = Math.abs(percent).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${percent < 0 ? '−' : '+'}${text}%`;
}

export interface Gain {
  text: string;
  tone: 'gain' | 'loss';
}

/** What it has made or lost since it was bought, as money and as a share of what it cost. None when it cost nothing. */
export function gainPill(valueMinor: number, costMinor: number, currency: string): Gain | null {
  if (costMinor <= 0) return null;
  const gain = valueMinor - costMinor;
  return { text: `${signed(gain, currency)} · ${percentLabel(gain, costMinor)}`, tone: gain < 0 ? 'loss' : 'gain' };
}

/** Where an estimate came from, in the words the line under the figure uses. */
const BASIS_WORDS: Record<ValuationBasis, string> = {
  estimate: 'estimate',
  appraisal: 'appraisal',
  listing: 'nearby listings',
  njop: 'NJOP',
  purchase: 'what was paid',
};

/** How much of a priced thing is held, in its own unit: "32 g", "5 lots", "500 shares", "12,5 units". */
export function quantityLabel(unitsMicro: number, unitKind: UnitKind | null, lotSize: number | null): string {
  if (unitKind === 'grams') return `${formatUnits(unitsMicro)} g`;
  if (unitKind === 'shares') {
    if (lotSize && lotSize > 1 && unitsMicro % (lotSize * 1_000_000) === 0) {
      const lots = unitsMicro / (lotSize * 1_000_000);
      return `${formatUnits(lots * 1_000_000)} ${lots === 1 ? 'lot' : 'lots'}`;
    }
    return `${formatUnits(unitsMicro)} shares`;
  }
  return `${formatUnits(unitsMicro)} units`;
}

/** A bond's face, held as units of one: 10.000.000 units is Rp 10.000.000 of face. */
const faceMinor = (unitsMicro: number, currency: string) => Math.round((unitsMicro / 1_000_000) * 10 ** currencyInfo(currency).exponent);

/** A price per unit of face as a share of it: 1,02 is "102% of face". */
export function percentOfFace(priceMicro: number, currency: string): string {
  const major = priceMicro / (PRICE_SCALE * 10 ** currencyInfo(currency).exponent);
  return `${(major * 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}% of face`;
}

/**
 * The grey line under the figure: what it is and how much of it, or — for a thing valued by an estimate — where the
 * value came from and when.
 */
export function heroLine(o: {
  kindLabel: string;
  mode: 'market' | 'snapshot' | 'derived';
  unitKind: UnitKind | null;
  unitsMicro: number;
  lotSize: number | null;
  currency: string;
  /** The estimate the value is, or null when it is still what was paid. */
  valuation: { basis: ValuationBasis; asOf: string } | null;
}): string {
  if (o.mode === 'snapshot') {
    return o.valuation ? `${o.kindLabel} · ${BASIS_WORDS[o.valuation.basis]}, ${dayLabel(o.valuation.asOf)}` : `${o.kindLabel} · what was paid`;
  }
  if (o.mode !== 'market' || o.unitsMicro <= 0) return o.kindLabel;
  if (o.unitKind === 'face') return `${o.kindLabel} · face ${formatMinor(faceMinor(o.unitsMicro, o.currency), o.currency)}`;
  return `${o.kindLabel} · ${quantityLabel(o.unitsMicro, o.unitKind, o.lotSize)}`;
}

export interface Tile {
  label: string;
  value: string;
  /** A small word beside the label that qualifies the figure: "not buyback" on a world gold price. */
  tag?: string;
  /** What the figure is, behind an ⓘ beside the label. */
  info?: string;
}

/** A price per unit, in the words of the unit: "Rp 2.485.000/g" for gold, a plain price for a share. */
const perUnit = (priceMicro: number, currency: string, unitKind: UnitKind | null) => `${formatPriceMicro(priceMicro, currency)}${unitKind === 'grams' ? '/g' : ''}`;

/**
 * The four labelled figures under the actions, for a priced thing. A tile with nothing to say is left out rather than
 * drawn with a dash: no price yet leaves the price tile off, nothing held leaves the average off.
 */
export function pricedTiles(o: {
  unitKind: UnitKind | null;
  unitsMicro: number;
  costMinor: number;
  lotSize: number | null;
  currency: string;
  /** The latest price, or null when none has been saved. */
  priceMicro: number | null;
  /** What the price tile is called: "Buyback today", "Close today", "World price". */
  priceLabel: string;
  /** The price tile's tag and ⓘ, when its label needs qualifying. */
  priceTag?: { tag: string; info: string };
}): Tile[] {
  const held = o.unitsMicro > 0;
  const average = held ? priceMicroFrom(o.costMinor, o.unitsMicro) : null;
  const tiles: (Tile | null)[] =
    o.unitKind === 'face'
      ? [
          { label: 'Face value', value: formatMinor(faceMinor(o.unitsMicro, o.currency), o.currency) },
          { label: 'Invested', value: formatMinor(o.costMinor, o.currency) },
          average === null ? null : { label: 'Average buy', value: percentOfFace(average, o.currency) },
          o.priceMicro === null ? null : { label: o.priceLabel, value: percentOfFace(o.priceMicro, o.currency) },
        ]
      : [
          o.unitKind === 'grams'
            ? { label: 'Total', value: quantityLabel(o.unitsMicro, o.unitKind, o.lotSize) }
            : { label: 'Held', value: heldLabel(o.unitsMicro, o.unitKind, o.lotSize) },
          { label: 'Invested', value: formatMinor(o.costMinor, o.currency) },
          average === null ? null : { label: 'Average buy', value: perUnit(average, o.currency, o.unitKind) },
          o.priceMicro === null ? null : { label: o.priceLabel, value: perUnit(o.priceMicro, o.currency, o.unitKind), ...o.priceTag },
        ];
  return tiles.filter((tile): tile is Tile => tile !== null);
}

/** Lots and shares both, when shares come in lots: "5 lots · 500". */
function heldLabel(unitsMicro: number, unitKind: UnitKind | null, lotSize: number | null): string {
  const quantity = quantityLabel(unitsMicro, unitKind, lotSize);
  return quantity.endsWith('lots') || quantity.endsWith('lot') ? `${quantity} · ${formatUnits(unitsMicro)}` : quantity;
}

/** A thing valued by an estimate: what was paid and when, and — when a loan bought it — what of it is paid off. */
export function estimatedTiles(o: { costMinor: number; boughtOn: string | null; currency: string; loan: { valueMinor: number; owedMinor: number } | null }): Tile[] {
  const tiles: (Tile | null)[] = [
    o.costMinor > 0 ? { label: 'Bought for', value: formatMinor(o.costMinor, o.currency) } : null,
    o.boughtOn ? { label: 'Bought on', value: dayLabel(o.boughtOn) } : null,
    o.loan ? { label: 'Yours', value: formatMinor(o.loan.valueMinor - o.loan.owedMinor, o.currency) } : null,
    o.loan ? { label: 'Loan left', value: formatMinor(o.loan.owedMinor, o.currency) } : null,
  ];
  return tiles.filter((tile): tile is Tile => tile !== null);
}

export interface TradeLine {
  title: string;
  subtitle: string;
  value: string;
  /** Under the value: a buy's own gain at today's price, or what an income or a sale was. */
  note: string | null;
  tone: 'gain' | 'loss' | 'quiet';
}

/**
 * One row of the buys, sells and income, in plain words. A buy is valued at today's price and shows its own gain; a
 * sale and a payment say what they brought in.
 */
export function tradeLine(
  trade: { kind: 'buy' | 'sell' | 'income' | 'unit_change'; occurredOn: string; unitsMicro: number; grossMinor: number; feeMinor: number },
  o: { unitKind: UnitKind | null; lotSize: number | null; currency: string; priceMicro: number | null; incomeWord: string },
): TradeLine {
  const quantity = o.unitKind === 'face' ? formatMinor(faceMinor(trade.unitsMicro, o.currency), o.currency) : quantityLabel(trade.unitsMicro, o.unitKind, o.lotSize);
  const unitPrice = trade.unitsMicro > 0 ? priceMicroFrom(trade.grossMinor, trade.unitsMicro) : null;
  const at = unitPrice === null ? '' : ` · ${o.unitKind === 'face' ? percentOfFace(unitPrice, o.currency).replace(' of face', '') : perUnit(unitPrice, o.currency, o.unitKind)}`;
  if (trade.kind === 'buy') {
    const cost = trade.grossMinor + trade.feeMinor;
    if (o.priceMicro === null) return { title: `Bought ${quantity}`, subtitle: `${dayLabel(trade.occurredOn)}${at}`, value: formatMinor(cost, o.currency), note: null, tone: 'quiet' };
    const now = unitsValueMinor(trade.unitsMicro, o.priceMicro);
    return {
      title: `Bought ${quantity}`,
      subtitle: `${dayLabel(trade.occurredOn)}${at}`,
      value: formatMinor(now, o.currency),
      note: signed(now - cost, o.currency),
      tone: now < cost ? 'loss' : 'gain',
    };
  }
  if (trade.kind === 'sell') return { title: `Sold ${quantity}`, subtitle: `${dayLabel(trade.occurredOn)}${at}`, value: formatMinor(trade.grossMinor, o.currency), note: 'received', tone: 'quiet' };
  if (trade.kind === 'income') return { title: o.incomeWord, subtitle: dayLabel(trade.occurredOn), value: `+${formatMinor(trade.grossMinor, o.currency)}`, note: 'income', tone: 'gain' };
  return { title: 'Units changed', subtitle: `${dayLabel(trade.occurredOn)} · ${quantity}`, value: '', note: null, tone: 'quiet' };
}

/**
 * The line under the grid, for a priced thing: where the price came from and the day it is for. A world price says so
 * by name; a price typed on the page, or a security's, is "Typed". A day that is not today and a fetch that failed
 * add the quiet way to try again.
 */
export function priceLine(o: {
  latest: { onDate: string; source: 'manual' | 'world' } | null;
  followsWorld: boolean;
  failed: boolean;
  today: string;
}): string {
  if (!o.latest) return o.followsWorld && o.failed ? 'No price yet · ↻ to try again' : 'No price yet, so it is valued at what was paid';
  const said = `${o.latest.source === 'world' ? 'World price (XAU)' : 'Typed'} · ${dayLabel(o.latest.onDate)}`;
  return o.followsWorld && o.failed && o.latest.onDate < o.today ? `${said} · ↻ to try again` : said;
}
