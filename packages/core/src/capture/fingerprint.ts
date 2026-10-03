import { findDateTime } from './date';
import { accountHintOf, paymentMethodOf } from './read';
import type { RawCapture, WordList } from './types';
import { WORDS } from './words';

/**
 * What makes two captures the same source.
 *
 * A source is an app's own layout: the words a screen always carries — its title bar, its brand, "Transaksi Berhasil"
 * — and, when it prints one, the masked digits of the account it is about. Two captures of the same source share that
 * set; the figures they are about do not, which is the whole point: the amounts are the one thing that is always
 * different between two payments and never different between two screens of one app.
 *
 * Only the top of the image is read. A receipt's body is the same everywhere and says nothing about where it came
 * from; the brand and the title are what tell one app's screen from another's.
 *
 * Two things in that band change from one payment to the next and are left out: the date, and a word standing alone
 * on its line — a logo, which on a wallet's transaction detail is the merchant's ("Lazada", "QRIS") as often as the
 * app's. A lone word the screen repeats (a watermark) is the app's own and stays. The digits of the card that paid are
 * left out too: paying with another card is still the same screen.
 */

/** How far down the image the words that name a source are looked for. */
const SOURCE_BAND = 0.15;

/** Letters only: a token carrying a figure is part of the capture's subject, not part of its shape. */
const WORD = /[\p{L}][\p{L}\p{N}']*/gu;

/** A word on a line of its own: what a logo, or a watermark, reads as. */
const LONE_WORD = /^[\p{L}][\p{L}'&.\-]*$/u;

/** How many lines of the capture are this one word and nothing else. */
function loneCounts(capture: RawCapture): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of capture.lines) {
    const text = line.text.trim();
    if (!LONE_WORD.test(text)) continue;
    counts.set(text.toLowerCase(), (counts.get(text.toLowerCase()) ?? 0) + 1);
  }
  return counts;
}

/** The words a fingerprint is made of: lower case, unique, and sorted so two sets can be compared as sets. */
export function fingerprintOf(capture: RawCapture): string[] {
  const words = new Set<string>();
  const lone = loneCounts(capture);
  for (const line of capture.lines) {
    if (line.box[1] >= SOURCE_BAND) continue;
    if (findDateTime(line.text) !== null) continue;
    const text = line.text.trim();
    if (LONE_WORD.test(text) && (lone.get(text.toLowerCase()) ?? 0) < 2) continue;
    for (const word of line.text.match(WORD) ?? []) {
      if (/^\p{L}+$/u.test(word)) words.add(word.toLowerCase());
    }
  }
  const paid = new Set(capture.lines.length > 0 ? (paymentMethodOf(capture)?.lines ?? []) : []);
  const text =
    capture.lines.length > 0
      ? capture.lines
          .filter((_line, index) => !paid.has(index))
          .map((line) => line.text)
          .join('\n')
      : [capture.title, capture.body].filter(Boolean).join('\n');
  const hint = accountHintOf(text);
  if (hint) words.add(`digits:${hint}`);
  return [...words].sort();
}

/** A word that could be an app's name: capitalised, letters only, short. */
const APP_WORD = /^\p{Lu}[\p{L}]{1,19}$/u;

/**
 * The app a screenshot is of, when the screen prints its name in a way that can be trusted — or null.
 *
 * Two places are trusted. The word a wallet prints its owner's ID under ("KANTONG ID 0811•••9159") is the wallet; and a
 * word the screen repeats on lines of their own is its watermark. A logo printed once is not: on a transaction detail
 * it is as often the merchant's. Nothing the reader already knows as a word of its own ("Total", "Saldo") counts.
 */
export function appNameOfScreen(capture: RawCapture, words: WordList = WORDS): string | null {
  const known = new Set(Object.values(words).flat());
  const score = new Map<string, { name: string; score: number }>();
  const add = (name: string, by: number) => {
    const key = name.toLowerCase();
    if (known.has(key)) return;
    const entry = score.get(key) ?? { name, score: 0 };
    entry.score += by;
    score.set(key, entry);
  };
  for (const line of capture.lines) {
    if (!/\d/.test(line.text)) continue;
    const tokens = line.text.trim().split(/\s+/);
    for (let index = 0; index + 1 < tokens.length; index += 1) {
      if (APP_WORD.test(tokens[index]!) && words.idLabels.includes(tokens[index + 1]!.toLowerCase())) add(tokens[index]!, 2);
    }
  }
  for (const line of capture.lines) {
    const text = line.text.trim();
    if (APP_WORD.test(text)) add(text, 1);
  }
  let best: { name: string; score: number } | null = null;
  for (const entry of score.values()) {
    if (entry.score < 2) continue;
    if (best === null || entry.score > best.score) best = entry;
  }
  return best?.name ?? null;
}

/**
 * Whether two fingerprints are the same source: at least seven words in ten shared.
 *
 * Seven rather than one, because a screen says a thing two ways from one version to the next, and never all of them;
 * and a set with no words in it is nobody's source, so an empty fingerprint matches nothing rather than everything.
 */
export function sameSource(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  const union = new Set([...left, ...right]).size;
  return union > 0 && shared / union >= 0.7;
}
