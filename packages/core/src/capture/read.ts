import { findAmounts } from './amount';
import { findDateTime } from './date';
import type { CaptureLine, Field, MoveType, RawCapture, Reading, Template, WordList } from './types';
import { WORDS } from './words';

/**
 * What one capture says, read out of it and nothing else.
 *
 * The reader is given a capture, the words of the languages it might be written in, and — when the source has been
 * corrected before — the place each field was found last time. It answers with a value, how sure it is, and for an
 * image the line the value came from, so the owner's correction can be turned back into a place to look next time.
 *
 * Three things it will not do, all of them because a wrong draft costs more than no draft:
 *
 * 1. A figure on a line with a balance word is never the amount. "Pembayaran Rp38.000 berhasil. Saldo Rp1.212.000" is
 *    a 38.000 payment, and the one number the reader is most likely to pick wrongly is the balance.
 * 2. A bare number is not money. Account numbers, reference numbers and OTP codes are digits too, and a figure counts
 *    only when it wears a currency mark or a thousand/million shorthand.
 * 3. Nothing is invented: an image with no figure in it is `unreadable`, and the caller falls back to what the phone
 *    knows rather than being handed a guess.
 */

/** One piece of a capture a value can come from: a line of an image, or a sentence of a notification. */
interface Unit {
  text: string;
  /** The index into `capture.lines`, or null when the text came from a notification's own words. */
  line: number | null;
  /** How tall the text was on the image, 0 for a notification. The largest type is what a screen is shouting. */
  height: number;
}

/**
 * How a notification's own words are cut into pieces.
 *
 * A full stop between two digits is a thousands mark — `Rp38.000` — so a sentence ends only where the stop is followed
 * by space, which is what keeps `'Pembayaran Rp38.000 berhasil. Saldo Rp1.212.000'` two sentences and not five.
 */
const SENTENCE = /(?<=[.!?])\s+|\n+/;

function unitsOf(capture: RawCapture): Unit[] {
  if (capture.lines.length > 0) {
    return capture.lines.map((line: CaptureLine, index) => ({ text: line.text, line: index, height: line.height }));
  }
  const text = [capture.title, capture.body].filter((part): part is string => part !== null && part !== '').join('. ');
  return text
    .split(SENTENCE)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((text) => ({ text, line: null, height: 0 }));
}

const folded = (text: string) => text.toLowerCase();

/** Whether a unit holds one of these words, at a word boundary — `masuk` but not `termasuk`. */
function holds(text: string, list: readonly string[]): string | null {
  const haystack = folded(text);
  for (const word of list) {
    let from = haystack.indexOf(word);
    while (from >= 0) {
      const before = haystack[from - 1];
      const after = haystack[from + word.length];
      const free = (char: string | undefined) => char === undefined || !/[a-z0-9]/.test(char);
      if (free(before) && free(after)) return word;
      from = haystack.indexOf(word, from + 1);
    }
  }
  return null;
}

const hasWord = (text: string, list: readonly string[]) => holds(text, list) !== null;

/** Where the first of these words stands on its own in the text, or null. */
function firstWordAt(text: string, list: readonly string[]): number | null {
  const haystack = folded(text);
  const free = (char: string | undefined) => char === undefined || !/[a-z0-9]/.test(char);
  let first: number | null = null;
  for (const word of list) {
    let from = haystack.indexOf(word);
    while (from >= 0) {
      if (free(haystack[from - 1]) && free(haystack[from + word.length])) {
        if (first === null || from < first) first = from;
        break;
      }
      from = haystack.indexOf(word, from + 1);
    }
  }
  return first;
}

/**
 * The text with every phrase that only looks like a direction blanked out, keeping every other character where it was.
 *
 * "Pembayaran Rp38.000 berhasil. Terima kasih" thanks the owner; it does not say money arrived.
 */
function directionText(text: string, words: WordList): string {
  let out = text;
  for (const phrase of words.notDirection) {
    const haystack = folded(out);
    const free = (char: string | undefined) => char === undefined || !/[a-z0-9]/.test(char);
    let from = haystack.indexOf(phrase);
    while (from >= 0) {
      if (free(haystack[from - 1]) && free(haystack[from + phrase.length])) {
        out = out.slice(0, from) + ' '.repeat(phrase.length) + out.slice(from + phrase.length);
      }
      from = haystack.indexOf(phrase, from + phrase.length);
    }
  }
  return out;
}

/** Whether a piece of the capture names a way the money went. */
const namesDirection = (text: string, words: WordList) => {
  const plain = directionText(text, words);
  return hasWord(plain, words.spent) || hasWord(plain, words.received) || hasWord(plain, words.topup) || hasWord(plain, words.refund);
};

/** The mask a capture prints before the digits of an account it does not want to spell out. */
const ACCOUNT_HINT = /(?:[·•*x]{2,}|[·•*x]{1,3}\s)[ \u00a0]*(\d{3,6})\b/gi;

/**
 * The masked digits of an account, as the capture printed them after the mask — or null when it printed none.
 *
 * A mask is not always an account: a wallet prints its owner's ID or phone number the same way ("ID 0811•••9159"), and
 * that number is a person, not where the money was. A mask whose own sentence carries an ID or phone label is passed
 * over.
 */
export function accountHintOf(text: string, words: WordList = WORDS): string | null {
  for (const line of text.split('\n')) {
    for (const match of line.matchAll(ACCOUNT_HINT)) {
      const clause = line.slice(0, match.index).split(/(?<=[.!?])\s+/).pop() ?? '';
      if (hasWord(clause, words.idLabels)) continue;
      return match[1]!;
    }
  }
  return null;
}

/**
 * The last four digits inside a payment method's value, however they were written: "(6175)", "•••• 6175", "xx6175",
 * "ending 6175", "akhiran 6175". The bracketed form counts only here, under a payment-method label — anywhere else a
 * figure in brackets is as likely a year.
 */
const LAST4 = /\((\d{4})\)|[·•*x]+\s*(\d{4})(?!\d)|\b(?:ending(?:\s+in)?|akhiran)\s*(\d{4})(?!\d)/i;

function last4Of(value: string): string | null {
  const match = LAST4.exec(value);
  return match ? (match[1] ?? match[2] ?? match[3])! : null;
}

/** What a capture says paid, and which of its lines said it. */
export interface PaymentMethodRead {
  text: string;
  last4: string | null;
  /** The label's line and the value's line, as indices into `capture.lines`; empty for a notification. */
  lines: number[];
}

/** The line set beside this one — the same height on the image, to the right of it — or the line under it. */
function valueLineOf(capture: RawCapture, index: number): number | null {
  const here = capture.lines[index];
  if (!here) return null;
  const [x, y, , h] = here.box;
  const beside = capture.lines.findIndex(
    (line, other) => other !== index && Math.abs(line.box[1] - y) < Math.max(h, line.box[3]) / 2 && line.box[0] > x,
  );
  if (beside >= 0) return beside;
  return capture.lines[index + 1] ? index + 1 : null;
}

/** Whether a payment method's text says it is a card: "Credit Card NUSA (6175)", "Kartu Debit". */
export function namesCard(text: string, words: WordList = WORDS): boolean {
  return hasWord(text, words.cardWords);
}

/**
 * The payment method: the value after a "Payment Method" or "Sumber Dana" label — on the label's own line, or on the
 * line beside or under it when the label stands alone.
 */
export function paymentMethodOf(capture: RawCapture, words: WordList = WORDS): PaymentMethodRead | null {
  const units = unitsOf(capture);
  for (let index = 0; index < units.length; index += 1) {
    const text = units[index]!.text;
    for (const label of words.paymentLabels) {
      const at = wordAt(text, label);
      if (at === null) continue;
      const rest = text
        .slice(at + label.length)
        .replace(/^\s*[:=]?\s*/, '')
        .split(/(?<=[.!?])\s+/)[0]!
        .trim();
      const line = units[index]!.line;
      if (rest !== '') return { text: rest, last4: last4Of(rest), lines: line === null ? [] : [line] };
      if (line === null) continue;
      const valueLine = valueLineOf(capture, line);
      const value = valueLine === null ? '' : capture.lines[valueLine]!.text.trim();
      if (value === '') continue;
      return { text: value, last4: last4Of(value), lines: [line, valueLine!] };
    }
  }
  return null;
}

/** A figure that may be an amount, with the unit it sat in. */
interface Figure {
  minor: number;
  currency: string | null;
  unit: number;
  /** Where it starts inside its unit, so a value can be cut out of the text after it. */
  start: number;
}

function figuresOf(units: readonly Unit[], words: WordList): Figure[] {
  const found: Figure[] = [];
  units.forEach((unit, index) => {
    for (const amount of findAmounts(unit.text, words)) {
      found.push({ minor: amount.minor, currency: amount.currency, unit: index, start: amount.start });
    }
  });
  return found;
}

/** The first unit whose text contains this label, or null. */
function unitWith(units: readonly Unit[], label: string): number | null {
  const needle = folded(label);
  const index = units.findIndex((unit) => folded(unit.text).includes(needle));
  return index < 0 ? null : index;
}

/** Whether a unit lies inside this region of the image. */
function inRegion(unit: Unit, template: Template, capture: RawCapture, field: 'amount' | 'name' | 'date'): boolean {
  const region = template[field]?.region;
  if (!region) return false;
  const line = unit.line;
  if (line === null) return false;
  const box = capture.lines[line]?.box;
  if (!box) return false;
  const [x, y, w, h] = region;
  const [bx, by, bw, bh] = box;
  return bx + bw / 2 >= x && bx + bw / 2 <= x + w && by + bh / 2 >= y && by + bh / 2 <= y + h;
}

/** The figure a learned anchor points at: the label's own line, the line under it, or the line inside the region. */
function amountFromTemplate(units: readonly Unit[], figures: readonly Figure[], capture: RawCapture, template: Template): Field<{ minor: number; currency: string | null }> | null {
  const label = template.amount?.label;
  if (label) {
    const at = unitWith(units, label);
    if (at !== null) {
      const here = figures.find((figure) => figure.unit === at);
      const next = figures.find((figure) => figure.unit === at + 1);
      const found = here ?? next;
      if (found) return { value: { minor: found.minor, currency: found.currency }, confidence: 95, line: units[found.unit]!.line };
    }
  }
  if (template.amount?.region) {
    const inside = figures.find((figure) => inRegion(units[figure.unit]!, template, capture, 'amount'));
    if (inside) return { value: { minor: inside.minor, currency: inside.currency }, confidence: 95, line: units[inside.unit]!.line };
  }
  return null;
}

/** A direction word before this figure, inside its own piece of the capture. */
function directedIn(unit: Unit, figure: Figure, words: WordList): boolean {
  return namesDirection(unit.text.slice(0, figure.start), words);
}

/**
 * The amount: the figure next to a label, else the largest type on an image, else the first figure after a direction
 * word, else the biggest figure that is not a balance.
 *
 * A figure sharing its line with a balance word is a balance and never the amount — unless a direction word introduced
 * it, because "Top up saldo Rp200.000" is a figure about the balance, not a figure that *is* one. That distinction is
 * the whole reason the top-up case works: the words are the same, the order is not.
 */
function amountOf(units: readonly Unit[], figures: readonly Figure[], words: WordList): Field<{ minor: number; currency: string | null }> | null {
  const clean = figures.filter((figure) => {
    const unit = units[figure.unit]!;
    if (!hasWord(unit.text, words.balance)) return true;
    return directedIn(unit, figure, words);
  });
  if (clean.length === 0) return null;
  const field = (figure: Figure, confidence: number): Field<{ minor: number; currency: string | null }> => ({
    value: { minor: figure.minor, currency: figure.currency },
    confidence,
    line: units[figure.unit]!.line,
  });

  // A figure under a label — "Total Bayar" over "Rp38.000", or both on one line.
  const labelled = clean.find((figure) => {
    const unit = units[figure.unit]!;
    if (hasWord(unit.text, words.amountLabels)) return true;
    const before = figure.unit > 0 ? units[figure.unit - 1] : undefined;
    return before !== undefined && before.line !== null && hasWord(before.text, words.amountLabels);
  });
  if (labelled) return field(labelled, 85);

  /* The largest type: what a screen shouts is what it is about — and only a screen that shouts at all. */
  const onImage = units.filter((unit) => unit.line !== null);
  if (onImage.length > 0) {
    const tallest = Math.max(...onImage.map((unit) => unit.height));
    const smallest = Math.min(...onImage.map((unit) => unit.height));
    if (tallest > smallest) {
      const shout = clean.find((figure) => units[figure.unit]!.height === tallest);
      if (shout) return field(shout, 60);
    }
  }

  const directed = clean.find((figure) => directedIn(units[figure.unit]!, figure, words));
  if (directed) return field(directed, 70);

  const largest = clean.reduce((best, figure) => (figure.minor > best.minor ? figure : best), clean[0]!);
  return field(largest, 50);
}

/** The first place in the capture one of these words stands: which piece, and where inside it. */
function firstPlace(units: readonly Unit[], list: readonly string[], words: WordList): { unit: number; at: number } | null {
  for (let index = 0; index < units.length; index += 1) {
    const at = firstWordAt(directionText(units[index]!.text, words), list);
    if (at !== null) return { unit: index, at };
  }
  return null;
}

/**
 * Which way the money went: the direction the capture names, or nothing read.
 *
 * A refund or a top-up is named as one and wins outright. Between money out and money in, the word said first is the
 * one the capture is about: "Pembayaran Rp38.000 berhasil diterima" is a payment, "Dana masuk … transfer ke rekening
 * Anda" is money arriving. Phrases that only look like a direction — thanks, a credit card — are not read at all.
 */
function typeOf(units: readonly Unit[], words: WordList, skipped: boolean): Field<MoveType> {
  if (skipped) return { value: 'spent', confidence: 0, line: null };
  for (const [list, value] of [
    [words.refund, 'refund'],
    [words.topup, 'topup'],
  ] as const) {
    const place = firstPlace(units, list, words);
    if (place) return { value, confidence: 85, line: units[place.unit]!.line };
  }
  const received = firstPlace(units, words.received, words);
  const spent = firstPlace(units, words.spent, words);
  const first =
    received && spent
      ? received.unit < spent.unit || (received.unit === spent.unit && received.at < spent.at)
        ? ('received' as const)
        : ('spent' as const)
      : received
        ? ('received' as const)
        : spent
          ? ('spent' as const)
          : null;
  if (first === 'received') return { value: 'received', confidence: 85, line: units[received!.unit]!.line };
  if (first === 'spent') return { value: 'spent', confidence: 85, line: units[spent!.unit]!.line };
  return { value: 'spent', confidence: 40, line: null };
}

const NAME_TOKEN = /^[\p{Lu}][\p{L}\p{N}'&.\-]*$/u;

/**
 * A name out of a run of words.
 *
 * The name is the capitalised words that open the run — "KOPI KENANGAN" out of "KOPI KENANGAN berhasil" — because a
 * capture that names a merchant sets it in capitals and the sentence around it in lower case. When nothing in the run
 * is capitalised there is no name to be sure of, and an empty field is worth more than "your account" written into
 * somebody's ledger.
 *
 * The run ends where the sentence does, or where the next figure starts: a dot inside a word is part of it, so
 * "TIKET.COM" survives, and a full stop followed by a space ends what came before it.
 */
function nameFrom(units: readonly Unit[], at: number, rest: string): { value: string; confidence: number; line: number | null } | null {
  const cut = rest.search(/[.,;:!?()](?=\s|$)| {2,}/);
  const head = (cut < 0 ? rest : rest.slice(0, cut)).trim();
  if (head === '') return null;
  const money = findAmounts(head, WORDS_FOR_CUT)[0];
  const words = (money ? head.slice(0, money.start) : head).trim().split(/\s+/).filter(Boolean);
  const capitalised = words.filter((word) => NAME_TOKEN.test(word));
  if (capitalised.length === 0) return null;
  const value = words.slice(0, capitalised.length).join(' ').trim();
  if (value === '') return null;
  return { value, confidence: 80, line: units[at]!.line };
}

/** The currency check inside a name is about cutting the name at the figure, so the words do not matter here. */
const WORDS_FOR_CUT: WordList = {
  spent: [],
  received: [],
  topup: [],
  refund: [],
  notDirection: [],
  promo: [],
  balance: [],
  amountLabels: [],
  nameLabels: [],
  nameLeadIns: [],
  paymentLabels: [],
  cardWords: [],
  idLabels: [],
  thousand: ['rb', 'ribu', 'k'],
  million: ['jt', 'juta', 'm'],
};

/**
 * What follows a label, when the word really is one.
 *
 * A label is punctuated — "Merchant: KOPI KENANGAN" — or it is the whole line, with the name on the next one. The
 * word alone is not enough: "TOKO MAKMUR" is a shop called "shop", and reading the label out of it left the name as
 * "MAKMUR".
 */
function afterLabel(text: string, label: string): string | null {
  const haystack = folded(text);
  let at = haystack.indexOf(label);
  while (at >= 0) {
    const free = (char: string | undefined) => char === undefined || !/[a-z0-9]/.test(char);
    if (free(haystack[at - 1]) && free(haystack[at + label.length])) {
      const tail = text.slice(at + label.length);
      const punctuated = /^\s*[:=]\s*/.exec(tail);
      if (punctuated) return tail.slice(punctuated[0].length);
      if (tail.trim() === '') return '';
    }
    at = haystack.indexOf(label, at + 1);
  }
  return null;
}

/** Where this word stands on its own in the text, over every place it stands. */
function wordAt(text: string, word: string): number | null {
  const haystack = folded(text);
  let at = haystack.indexOf(word);
  const free = (char: string | undefined) => char === undefined || !/[a-z0-9]/.test(char);
  while (at >= 0) {
    if (free(haystack[at - 1]) && free(haystack[at + word.length])) return at;
    at = haystack.indexOf(word, at + 1);
  }
  return null;
}

/** The name: after a label, or after a word that introduces one — on this unit or the one under it. */
function nameOf(units: readonly Unit[], words: WordList, capture: RawCapture, template: Template): Field<string> | null {
  const label = template.name?.label;
  if (label) {
    const at = unitWith(units, label);
    if (at !== null) {
      const rest = units[at]!.text.slice(units[at]!.text.toLowerCase().indexOf(label.toLowerCase()) + label.length);
      const found = nameFrom(units, at, rest) ?? (units[at + 1] ? nameFrom(units, at + 1, units[at + 1]!.text) : null);
      if (found) return { value: found.value, confidence: 95, line: found.line };
    }
  }
  if (template.name?.region) {
    const at = units.findIndex((unit) => inRegion(unit, template, capture, 'name'));
    if (at >= 0) {
      const found = nameFrom(units, at, units[at]!.text);
      if (found) return { value: found.value, confidence: 95, line: found.line };
    }
  }

  for (let index = 0; index < units.length; index += 1) {
    const text = units[index]!.text;
    for (const word of words.nameLabels) {
      const rest = afterLabel(text, word);
      if (rest === null) continue;
      /* An empty rest is a label on a line of its own: the name is the line under it. Words that held no name at all
         are not that — "Refunded $9.99 to your card ending 4321" is followed by a reference line, not a name. */
      const here = nameFrom(units, index, rest);
      if (here) return { value: here.value, confidence: here.confidence, line: here.line };
      if (rest.trim() === '' && units[index + 1]) {
        const next = nameFrom(units, index + 1, units[index + 1]!.text);
        if (next) return { value: next.value, confidence: next.confidence, line: next.line };
      }
    }
  }

  for (let index = 0; index < units.length; index += 1) {
    const text = units[index]!.text;
    for (const lead of words.nameLeadIns) {
      const at = wordAt(text, lead);
      if (at === null) continue;
      const rest = text.slice(at + lead.length);
      const here = nameFrom(units, index, rest);
      if (here) return { value: here.value, confidence: 75, line: here.line };
      if (rest.trim() === '' && units[index + 1]) {
        const next = nameFrom(units, index + 1, units[index + 1]!.text);
        if (next) return { value: next.value, confidence: 75, line: next.line };
      }
    }
  }
  return null;
}

/** The date: what the capture printed, and nothing when it printed none — the caller knows when it arrived. */
function dateOf(units: readonly Unit[], capture: RawCapture, template: Template): Field<string> | null {
  const label = template.date?.label;
  if (label) {
    const at = unitWith(units, label);
    if (at !== null) {
      const found = findDateTime(units[at]!.text) ?? (units[at + 1] ? findDateTime(units[at + 1]!.text) : null);
      if (found) return { value: found, confidence: 95, line: units[at]!.line };
    }
  }
  if (template.date?.region) {
    const at = units.findIndex((unit) => inRegion(unit, template, capture, 'date'));
    if (at >= 0) {
      const found = findDateTime(units[at]!.text);
      if (found) return { value: found, confidence: 95, line: units[at]!.line };
    }
  }
  for (const unit of units) {
    const found = findDateTime(unit.text);
    if (found) return { value: found, confidence: 80, line: unit.line };
  }
  return null;
}

/**
 * The capture with its offers set aside, or null when the offer is all it is.
 *
 * A payment confirmation often carries an offer as well — "Pembayaran Rp38.000 berhasil. Kamu dapat cashback Rp3.800",
 * "+50 poin", a receipt's DISKON line — and that is still a payment. So a piece holding a promo word is left out, and
 * the capture is an offer only when what is left holds no figure, or names no movement and labels no total: "Cashback
 * Rp5.000 masuk!" is about the cashback, and every piece of it says so.
 */
function withoutOffers(units: readonly Unit[], words: WordList): Unit[] | null {
  const rest = units.filter((unit) => !hasWord(unit.text, words.promo));
  if (rest.length === units.length) return [...units];
  const hasFigure = rest.some((unit) => findAmounts(unit.text, words).length > 0);
  const saysWhat = rest.some((unit) => namesDirection(unit.text, words) || hasWord(unit.text, words.amountLabels));
  return hasFigure && saysWhat ? rest : null;
}

const SKIPPED = (skipped: 'promo' | 'unreadable', accountHint: string | null, paymentMethod: Reading['paymentMethod']): Reading => ({
  skipped,
  amount: null,
  occurredAt: null,
  type: { value: 'spent', confidence: 0, line: null },
  name: null,
  accountHint,
  paymentMethod,
});

/**
 * Read a capture.
 *
 * The order is the order the spec sets: an offer is skipped before anything is read, then the amount, then everything
 * else — so a capture that is skipped never contributes a figure, however many it prints.
 */
export function readCapture(
  capture: RawCapture,
  words: WordList,
  template: Template | null,
  opts: {
    /** False reads an offer for its money anyway: the owner bringing back a skipped capture has overruled the filter. */
    skipPromos?: boolean;
  } = {},
): Reading {
  const all = unitsOf(capture);
  const text = all.map((unit) => unit.text).join('\n');
  // What paid is the account the money left, when the capture says so; a masked number elsewhere is the next best.
  const method = paymentMethodOf(capture, words);
  const paymentMethod = method ? { text: method.text, last4: method.last4 } : null;
  const hint = paymentMethod?.last4 ?? accountHintOf(text, words);

  if (all.length === 0) return SKIPPED('unreadable', hint, paymentMethod);
  const units = opts.skipPromos === false ? all : withoutOffers(all, words);
  if (units === null) return SKIPPED('promo', hint, paymentMethod);

  const learned = template ?? null;
  const figures = figuresOf(units, words);
  const amount = (learned ? amountFromTemplate(units, figures, capture, learned) : null) ?? amountOf(units, figures, words);

  if (amount === null) {
    // An image with no figure is nothing; a notification with no figure is nothing to record either.
    return SKIPPED('unreadable', hint, paymentMethod);
  }

  return {
    skipped: null,
    amount,
    occurredAt: dateOf(units, capture, learned ?? {}),
    type: typeOf(units, words, false),
    name: nameOf(units, words, capture, learned ?? {}),
    accountHint: hint,
    paymentMethod,
  };
}
