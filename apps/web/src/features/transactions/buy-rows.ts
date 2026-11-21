/**
 * What each row of the Buy / sell tab says.
 *
 * The tab used to be the only one still drawn label-left, value-right, with the currency written into the label
 * — "What it cost, before fees (IDR)" — and its hints set as full-width paragraphs between the rows. It now reads
 * like Expense, Income and Transfer: a 28px glyph in the lead, the value as the row's own text on the left, a
 * small grey caption on the right, and the money rows leading with the currency's flag.
 *
 * Moving the currency onto the flag must **not** move it out of the row's accessible name: "Fee (USD)" is how
 * every journey, and every screen reader, already knows that field. So each row has two halves — `label`, which
 * is the name and never changes, and `caption`/`placeholder`, which is what is drawn. They are said once, here,
 * so the drawn row and the named row can never drift apart.
 */

export type BuyMode = 'buy' | 'sell';

/** A trade's money side: a buy pays, a sell or a payment lands somewhere. */
export type TradeSide = BuyMode | 'income';

export interface BuyRowText {
  /** The accessible name: unchanged from the label the row carried when it was a label-left row. */
  label: string;
  /** The small grey word on the right of the row. */
  caption: string;
  /** What the row's own text says while it is empty. */
  placeholder?: string;
  /** The line under the row, in the muted ink — where the tab used to put a full-width paragraph. */
  hint?: string;
}

/**
 * The holding row: what was bought or sold. It reads like Expense's Category row — the holding's name and nothing
 * else (owner, 13 Nov 2026): the Buy / Sell tab above it already says which way it went, so there is no caption.
 */
export function holdingRowText(): BuyRowText {
  return { label: 'Investment', caption: '', placeholder: 'Investment' };
}

/**
 * The holding's own name, out of the picker's label. The picker groups its options — "Investments › Antam",
 * "Sell › Antam" — and the group is now the row's caption, so drawing it again in the value would say Bought
 * twice and truncate the name that matters at 390px.
 */
export function holdingFace(label: string): string {
  const cut = label.lastIndexOf(' › ');
  return cut === -1 ? label : label.slice(cut + 3);
}

/** The gross figure: what it cost, or what the sale brought in, both before fees and both in the holding's money. */
export function amountRowText(mode: BuyMode, currency: string): BuyRowText {
  const words = mode === 'buy' ? 'What it cost, before fees' : 'Proceeds, before fees';
  return { label: `${words} (${currency})`, caption: currency, placeholder: words };
}

/**
 * The fee. Its caption is the word rather than the code: two money rows one above the other, both captioned
 * "IDR", name neither of them — and the flag in the lead is already saying which currency this is.
 */
export function feeRowText(currency: string): BuyRowText {
  return { label: `Fee (${currency})`, caption: 'Fee', placeholder: 'Amount' };
}

/** How much of the holding moved: lots where the holding trades in them, otherwise its own word for a unit. */
export function unitsRowText({ useLots, lotSize, unitLabel }: { useLots: boolean; lotSize: number | null; unitLabel: string }): BuyRowText {
  const label = useLots ? 'Lots' : unitLabel;
  // A lot's size rides on the right of the row, on its one line, with the word.
  return { label, caption: useLots ? `${label} · ${lotSize ?? 1} shares` : label, placeholder: 'How many' };
}

/** Where the money came from, or where it landed: the Expense and Income forms' own words. */
export function payRowText(mode: TradeSide): BuyRowText {
  const label = mode === 'buy' ? 'Payment method' : 'Received into';
  return { label, caption: label };
}

/** What the money row reads while a trade made before the app names no account: Opening Balances stands for it. */
export function pastWord(mode: TradeSide): string {
  return mode === 'buy' ? 'Past purchase' : mode === 'sell' ? 'Past sale' : 'Past payment';
}

/** A foreign trade's settling figure: what the paying account itself moved, in its own currency. */
export function chargedRowText({ mode, cashCurrency, moneyName }: { mode: BuyMode; cashCurrency: string; moneyName: string }): BuyRowText {
  return {
    label: `Charged in ${cashCurrency}`,
    caption: `Charged in ${cashCurrency}`,
    placeholder: 'Amount',
    hint: mode === 'buy' ? `What left ${moneyName}, in ${cashCurrency}.` : `What reached ${moneyName}, in ${cashCurrency}.`,
  };
}

/** The goal a purchase funds, or the goal a sale takes units out of. */
export function goalRowText(mode: BuyMode): BuyRowText {
  const label = mode === 'buy' ? 'Goal' : 'From goal';
  return { label, caption: label };
}

const UNIT_WORDS: Record<string, string> = { units: 'Units', shares: 'Shares', grams: 'Grams', face: 'Par value' };

/** The units row's word for a holding, by how it is counted: Grams, Shares, Par value; Units for anything else. */
export function unitWord(unitKind: string | null | undefined): string {
  return UNIT_WORDS[unitKind ?? 'units'] ?? 'Units';
}
