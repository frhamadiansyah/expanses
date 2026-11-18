import type { PastedCells, QuickValues } from './quick-row';

/*
 * A paste's categories (Mac Cashflow, owner 2026-11-18). A Category cell is read against the real category and
 * sub-category names first (`resolveCategory`). What that leaves:
 *  - an empty cell takes the typing row's guess — the category the last purchase at that place was recorded in;
 *  - a name that matches no category ("Makan") stays orange, until the owner picks one for that row and records it:
 *    this device then remembers "Makan" as that category, and the next paste fills it in.
 * Either fill is marked as guessed on its row. Nothing is ever guessed from the amount, and a row with no history and
 * no remembered name stays orange. Kept on this device alone (localStorage): no sync, nothing in the database.
 */

/** How a pasted row's category came to be filled: from the place's history, or from a name remembered on this device. */
export type PasteGuess = 'history' | 'remembered';

/** What the table keeps of a pasted row until it is recorded or discarded. */
export interface PasteMark {
  /** The Category cell's text when it matched no category: what recording the row teaches. */
  text?: string;
  /** The category filled in for it, and how; shown as guessed while the row still names it. */
  guessed?: { categoryId: string; how: PasteGuess };
}

/** One pasted row, as `pastedCategories` hands it to the table: its cells read, and what to keep of it. */
export interface PastedRow {
  values: QuickValues;
  mark: PasteMark;
}

/** The storage the names live in: `localStorage`, or a stand-in in tests. */
export interface NameStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const NAMES_KEY = 'paste-category-names';
const MARKS_KEY = 'paste-rows';

/** "  Makan  Siang " and "makan siang" are one name. */
export const nameKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

function readJson<T extends object>(store: NameStore | null, key: string): T {
  try {
    const raw = store?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

function writeJson(store: NameStore | null, key: string, value: object) {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // A private window or full storage: the names are a convenience, and the paste still works without them.
  }
}

/** The page's own storage, when it has one it may use. */
export function deviceStore(): NameStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The category a name was last recorded as, from a paste on this device. */
export function rememberedCategory(text: string, store: NameStore | null = deviceStore()): string | null {
  const key = nameKey(text);
  if (!key) return null;
  return readJson<Record<string, string>>(store, NAMES_KEY)[key] ?? null;
}

/** Every pasted row's mark, by draft. */
export function readMarks(store: NameStore | null = deviceStore()): Record<string, PasteMark> {
  return readJson<Record<string, PasteMark>>(store, MARKS_KEY);
}

/**
 * Keeps the marks of rows just pasted, and lets go of those whose rows are no longer waiting (`waiting`, the drafts
 * there are now), so the map never outgrows the table.
 */
export function keepMarks(made: Readonly<Record<string, PasteMark>>, waiting: ReadonlySet<string>, store: NameStore | null = deviceStore()): Record<string, PasteMark> {
  const kept = Object.fromEntries(Object.entries(readMarks(store)).filter(([id]) => waiting.has(id)));
  const next = { ...kept, ...Object.fromEntries(Object.entries(made).filter(([, mark]) => mark.text || mark.guessed)) };
  writeJson(store, MARKS_KEY, next);
  return next;
}

/**
 * A pasted row recorded: a name that matched no category is remembered as the category it was recorded with, and the
 * row's mark goes. A row with no such name teaches nothing.
 */
export function learnFromRecorded(draftId: string, categoryId: string, store: NameStore | null = deviceStore()): Record<string, PasteMark> {
  const marks = readMarks(store);
  const text = marks[draftId]?.text;
  if (text && categoryId) writeJson(store, NAMES_KEY, { ...readJson<Record<string, string>>(store, NAMES_KEY), [nameKey(text)]: categoryId });
  return forgetMark(draftId, store);
}

/** A pasted row discarded (or recorded): its mark goes. */
export function forgetMark(draftId: string, store: NameStore | null = deviceStore()): Record<string, PasteMark> {
  const marks = readMarks(store);
  if (!(draftId in marks)) return marks;
  const { [draftId]: _gone, ...rest } = marks;
  writeJson(store, MARKS_KEY, rest);
  return rest;
}

/**
 * Each pasted row's category, by the rules above: a matched name as it was matched; an unmatched name by what this
 * device remembers of it; an empty cell by the place's history. `offered` says whether a category may be filled in
 * here (it is still one the cell offers); `history` is the typing row's own guess (`handlers.guessCategory`).
 */
export async function pastedCategories(
  rows: readonly { cells: PastedCells; values: QuickValues }[],
  ctx: { remembered: (text: string) => string | null; history: (description: string) => Promise<string | null>; offered: (categoryId: string) => boolean },
): Promise<PastedRow[]> {
  return Promise.all(
    rows.map(async ({ cells, values }): Promise<PastedRow> => {
      if (values.categoryId) return { values, mark: {} };
      const text = cells.category.trim();
      if (text) {
        const known = ctx.remembered(text);
        return known && ctx.offered(known) ? { values: { ...values, categoryId: known }, mark: { text, guessed: { categoryId: known, how: 'remembered' } } } : { values, mark: { text } };
      }
      const description = values.description.trim();
      const guess = description ? await ctx.history(description).catch(() => null) : null;
      return guess && ctx.offered(guess) ? { values: { ...values, categoryId: guess }, mark: { guessed: { categoryId: guess, how: 'history' } } } : { values, mark: {} };
    }),
  );
}

/** What a guessed cell says on hover and to a reader. */
export function guessHint(mark: PasteMark | undefined): string | null {
  if (!mark?.guessed) return null;
  return mark.guessed.how === 'history' ? 'Category guessed from the last time this was bought here' : `Category guessed from an earlier paste of “${mark.text ?? ''}”`;
}
