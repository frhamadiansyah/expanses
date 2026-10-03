import { accountHintOf } from './read';
import type { RawCapture } from './types';

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
 */

/** How far down the image the words that name a source are looked for. */
const SOURCE_BAND = 0.15;

/** Letters only: a token carrying a figure is part of the capture's subject, not part of its shape. */
const WORD = /[\p{L}][\p{L}\p{N}']*/gu;

/** The words a fingerprint is made of: lower case, unique, and sorted so two sets can be compared as sets. */
export function fingerprintOf(capture: RawCapture): string[] {
  const words = new Set<string>();
  for (const line of capture.lines) {
    if (line.box[1] >= SOURCE_BAND) continue;
    for (const word of line.text.match(WORD) ?? []) {
      if (/^\p{L}+$/u.test(word)) words.add(word.toLowerCase());
    }
  }
  const text = capture.lines.length > 0 ? capture.lines.map((line) => line.text).join('\n') : [capture.title, capture.body].filter(Boolean).join('\n');
  const hint = accountHintOf(text);
  if (hint) words.add(`digits:${hint}`);
  return [...words].sort();
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
