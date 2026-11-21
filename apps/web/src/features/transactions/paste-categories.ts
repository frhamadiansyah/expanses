import { foldName, lastFourOf, type PastedCells, paymentKey, type QuickValues } from './quick-row';

/*
 * A paste's categories and Paid with (Mac Cashflow, owner 2026-11-18). A Category cell is read against the real
 * category and sub-category names first (`resolvePastedCategory`), a Paid with cell against the ways to pay. What that
 * leaves:
 *  - an empty Category cell takes the typing row's guess — the category the last purchase at that place was recorded in;
 *  - a name that matches nothing ("Makan"), or a Notion relation's page link (`notionKey`, the same page every time),
 *    stays blank until the owner picks a value for that row and the row is saved, or until the row is recorded with a
 *    value (recording says yes to what the row shows, the place's history guess included): this device then remembers
 *    the name or link as that value, every other waiting pasted row naming it fills in, and so does the next paste. A
 *    Notion link with no category remembered yet still takes the place's history, as an empty cell does.
 * Either fill is marked as guessed on its row. Nothing is ever guessed from the amount, and a row with no history and
 * nothing remembered stays blank. Kept on this device alone (localStorage): no sync, nothing in the database.
 */

/** How a pasted row's category came to be filled: from the place's history, or from a name remembered on this device. */
export type PasteGuess = 'history' | 'remembered';

/** What the table keeps of a pasted row until it is recorded or discarded. */
export interface PasteMark {
  /** The Category cell's text when it matched no category, or its Notion link's key: what the row teaches. */
  text?: string;
  /** The category filled in for it, and how; shown as guessed while the row still names it. */
  guessed?: { categoryId: string; how: PasteGuess };
  /** The Paid with cell's text when it matched no way to pay, or its Notion link's key: what the row teaches. */
  paid?: string;
  /** The way to pay (`paymentKey`) filled in for it from what this device remembers. */
  paidGuessed?: string;
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
const PAID_KEY = 'paste-paid-names';
const MARKS_KEY = 'paste-rows';

/** "  Makan  Siang " and "makan siang" are one name, as are "Café & Co" and "cafe and co" (`foldName`). */
export const nameKey = foldName;
/** How a name was kept before accents and "&" were folded (18 Nov 2026), so a name taught then is still known. */
const earlierKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

/** A Notion relation's key (`notionKey`) rather than a name. */
export const isLinkKey = (text: string) => text.startsWith('notion:');

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

function remembered(map: string, text: string, store: NameStore | null): string | null {
  const key = nameKey(text);
  if (!key) return null;
  const names = readJson<Record<string, string>>(store, map);
  return names[key] ?? names[earlierKey(text)] ?? null;
}

/** The category a name or Notion link was last given, from a paste on this device. */
export function rememberedCategory(text: string, store: NameStore | null = deviceStore()): string | null {
  return remembered(NAMES_KEY, text, store);
}

/** The way to pay (`paymentKey`) a Paid with name or Notion link was last given, from a paste on this device. */
export function rememberedPaid(text: string, store: NameStore | null = deviceStore()): string | null {
  return remembered(PAID_KEY, text, store);
}

function remember(map: string, text: string, value: string, store: NameStore | null) {
  writeJson(store, map, { ...readJson<Record<string, string>>(store, map), [nameKey(text)]: value });
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
  const next = { ...kept, ...Object.fromEntries(Object.entries(made).filter(([, mark]) => mark.text || mark.guessed || mark.paid)) };
  writeJson(store, MARKS_KEY, next);
  return next;
}

/** A waiting pasted row as its cells read now. */
export interface WaitingRow {
  id: string;
  values: QuickValues;
}

const tidy = (mark: PasteMark): PasteMark => Object.fromEntries(Object.entries(mark).filter(([, value]) => value !== undefined)) as PasteMark;

/**
 * A pasted row saved (`record` false: kept as not recorded) or recorded with these cells. A name or link of its that
 * matched nothing is remembered as the row's value (`teaches`): when saved, only a value the owner picked (not the
 * guess the paste filled in); when recorded, whatever the row shows — the place's history guess too, since recording is
 * the owner's yes — unless it still shows the paste's guess and the name or link is already remembered (nothing new,
 * and a remembered value is never put back by an unchanged row). Every other waiting pasted row (`waiting`) naming the
 * same name or link, its cell still empty or still the paste's guess, fills in: `fills` are those rows' new cells, to
 * save as drafts, already marked as guessed. A recorded row's mark goes.
 */
export function learnFromSaved(
  draftId: string,
  values: QuickValues,
  record: boolean,
  waiting: readonly WaitingRow[] = [],
  store: NameStore | null = deviceStore(),
): { marks: Record<string, PasteMark>; fills: WaitingRow[] } {
  const marks = readMarks(store);
  const mark = marks[draftId];
  if (!mark) return { marks, fills: [] };
  const paidNow = values.accountId ? paymentKey(values.accountId, values.cardId) : '';
  // A value the owner changed always teaches; the paste's own guess teaches only when recorded and nothing is remembered yet.
  const teaches = (map: string, text: string | undefined, now: string, guess: string | undefined) =>
    !!text && !!now && (now !== guess || (record && !remembered(map, text, store)));
  const category = teaches(NAMES_KEY, mark.text, values.categoryId, mark.guessed?.categoryId) ? { key: nameKey(mark.text!), id: values.categoryId } : null;
  // Paid with rows are grouped as the picker groups them: "5512" and "•• 5512" name one card (`pendingPaidKey`).
  const paid = teaches(PAID_KEY, mark.paid, paidNow, mark.paidGuessed) ? { key: pendingPaidKey(mark.paid!), id: paidNow } : null;
  if (category) remember(NAMES_KEY, mark.text!, category.id, store);
  if (paid) remember(PAID_KEY, mark.paid!, paid.id, store);

  const next: Record<string, PasteMark> = { ...marks };
  if (record) delete next[draftId];
  else next[draftId] = tidy({ ...mark, guessed: category ? undefined : mark.guessed, paidGuessed: paid ? undefined : mark.paidGuessed });

  const fills: WaitingRow[] = [];
  for (const row of waiting) {
    const its = next[row.id];
    if (row.id === draftId || !its) continue;
    let cells = row.values;
    let updated = its;
    if (category && its.text && nameKey(its.text) === category.key && cells.categoryId !== category.id && (!cells.categoryId || cells.categoryId === its.guessed?.categoryId)) {
      cells = { ...cells, categoryId: category.id };
      updated = { ...updated, guessed: { categoryId: category.id, how: 'remembered' } };
    }
    const itsPaid = cells.accountId ? paymentKey(cells.accountId, cells.cardId) : '';
    if (paid && its.paid && pendingPaidKey(its.paid) === paid.key && itsPaid !== paid.id && (!itsPaid || itsPaid === its.paidGuessed)) {
      const [accountId = '', cardId = ''] = paid.id.split(':');
      cells = { ...cells, accountId, cardId };
      updated = { ...updated, paidGuessed: paid.id };
    }
    if (cells !== row.values) {
      next[row.id] = updated;
      fills.push({ id: row.id, values: cells });
    }
  }
  writeJson(store, MARKS_KEY, next);
  return { marks: next, fills };
}

/** A pasted row recorded with this category: what it teaches (`learnFromSaved`), its mark let go. */
export function learnFromRecorded(draftId: string, categoryId: string, store: NameStore | null = deviceStore()): Record<string, PasteMark> {
  const blank: QuickValues = { date: '', description: '', amount: '', accountId: '', cardId: '', categoryId };
  return learnFromSaved(draftId, blank, true, [], store).marks;
}

/**
 * How many Notion links the waiting pasted rows (`waiting`, by id) name that this device does not know yet — a
 * Category link with no category remembered, a Paid with link with no way to pay remembered.
 */
export function unknownLinks(marks: Readonly<Record<string, PasteMark>>, waiting: ReadonlySet<string>, store: NameStore | null = deviceStore()): number {
  const categories = new Set<string>();
  const paid = new Set<string>();
  for (const [id, mark] of Object.entries(marks)) {
    if (!waiting.has(id)) continue;
    if (mark.text && isLinkKey(mark.text) && !rememberedCategory(mark.text, store)) categories.add(mark.text);
    if (mark.paid && isLinkKey(mark.paid) && !rememberedPaid(mark.paid, store)) paid.add(mark.paid);
  }
  return categories.size + paid.size;
}

/** The box header's light grey count while some of the waiting rows' Notion links are not known yet: "2 Notion links to pick". */
export const unknownLinksLine = (count: number) => (count === 1 ? '1 Notion link to pick' : `${count} Notion links to pick`);

/** A pasted row discarded (or recorded): its mark goes. */
export function forgetMark(draftId: string, store: NameStore | null = deviceStore()): Record<string, PasteMark> {
  const marks = readMarks(store);
  if (!(draftId in marks)) return marks;
  const { [draftId]: _gone, ...rest } = marks;
  writeJson(store, MARKS_KEY, rest);
  return rest;
}

/**
 * Each pasted row's category and Paid with, by the rules above: a matched name as it was matched; an unmatched name or
 * a Notion link by what this device remembers of it; an empty Category cell — or an unknown link — by the place's
 * history. `offered` says whether a category may be filled in here (it is still one the cell offers), `offeredPaid`
 * the same of a way to pay; `history` is the typing row's own guess (`handlers.guessCategory`).
 */
export async function pastedCategories(
  rows: readonly { cells: PastedCells; values: QuickValues }[],
  ctx: {
    remembered: (text: string) => string | null;
    history: (description: string) => Promise<string | null>;
    offered: (categoryId: string) => boolean;
    rememberedPaid?: (text: string) => string | null;
    offeredPaid?: (key: string) => boolean;
  },
): Promise<PastedRow[]> {
  return Promise.all(rows.map(async (row) => pastedPaid(await pastedCategory(row, ctx), row.cells, ctx)));
}

async function pastedCategory({ cells, values }: { cells: PastedCells; values: QuickValues }, ctx: Parameters<typeof pastedCategories>[1]): Promise<PastedRow> {
  if (values.categoryId) return { values, mark: {} };
  const link = cells.links?.category;
  const text = link ?? cells.category.trim();
  if (text) {
    const known = ctx.remembered(text);
    if (known && ctx.offered(known)) return { values: { ...values, categoryId: known }, mark: { text, guessed: { categoryId: known, how: 'remembered' } } };
    // A name no category has is never guessed past; a link not known yet is still the place's, as an empty cell is.
    if (!link) return { values, mark: { text } };
  }
  const description = values.description.trim();
  const guess = description ? await ctx.history(description).catch(() => null) : null;
  const mark: PasteMark = link ? { text: link } : {};
  return guess && ctx.offered(guess) ? { values: { ...values, categoryId: guess }, mark: { ...mark, guessed: { categoryId: guess, how: 'history' } } } : { values, mark };
}

function pastedPaid(row: PastedRow, cells: PastedCells, ctx: Parameters<typeof pastedCategories>[1]): PastedRow {
  const text = cells.links?.paid ?? cells.paid.trim();
  if (row.values.accountId || !text || !ctx.rememberedPaid) return row;
  const known = ctx.rememberedPaid(text);
  if (!known || !(ctx.offeredPaid?.(known) ?? false)) return { ...row, mark: { ...row.mark, paid: text } };
  const [accountId = '', cardId = ''] = known.split(':');
  return { values: { ...row.values, accountId, cardId }, mark: { ...row.mark, paid: text, paidGuessed: known } };
}

/** What a guessed Category cell says on hover and to a reader. */
export function guessHint(mark: PasteMark | undefined): string | null {
  if (!mark?.guessed) return null;
  if (mark.guessed.how === 'history') return 'Category guessed from the last time this was bought here';
  return mark.text && isLinkKey(mark.text) ? 'Category remembered for this Notion link' : `Category guessed from an earlier paste of “${mark.text ?? ''}”`;
}

/** What a remembered Paid with cell says on hover and to a reader. */
export function paidHint(mark: PasteMark | undefined): string | null {
  if (!mark?.paidGuessed || !mark.paid) return null;
  return isLinkKey(mark.paid) ? 'Payment method remembered for this Notion link' : `Payment method guessed from an earlier paste of “${mark.paid}”`;
}

/*
 * A Paid with cell that names nothing in cicis yet (owner 2026-11-20, mockup 2026-11-20-paste-new-account): the pasted
 * text stays on its row — kept in the row's mark (`paid`), on this device, until the row is recorded or discarded — and
 * shows in the cell with a dashed line, last four digits as "•• 5512", a name as pasted; a Notion link shows nothing
 * (an address is never put into a cell). The cell's picker offers to add it as a new card or account, and adding one
 * fills every waiting row naming the same digits, name or link (`fillAddedPaid`).
 */

/** What groups waiting rows that name one thing: the last four digits ("5512", "•• 5512", "xxxx 5512" alike), else the name folded, else the link. */
export function pendingPaidKey(text: string): string {
  if (isLinkKey(text)) return text;
  const four = lastFourOf(text);
  return four ? `last4:${four}` : nameKey(text);
}

/** How a waiting row's unmatched Paid with reads in its cell: "•• 5512", the name as pasted, or nothing for a Notion link. */
export function pendingPaidLabel(text: string | undefined): string | null {
  const shown = text?.trim();
  if (!shown || isLinkKey(shown)) return null;
  const four = lastFourOf(shown);
  return four ? `•• ${four}` : shown;
}

/** The pasted text a waiting row still holds for its Paid with: only while the cell names no way to pay. */
export function pendingPaidOf(mark: PasteMark | undefined, values: Pick<QuickValues, 'accountId'>): string | null {
  return mark?.paid && !values.accountId ? mark.paid : null;
}

/** One "＋ Add …" the Paid with picker offers for a pasted text not in cicis yet. */
export interface AddPaidChoice {
  kind: 'card' | 'account';
  label: string;
  /** The waiting rows naming it (shown on the first choice): "2 rows". */
  rows: number;
  /** What the new card's or account's form is filled in with. */
  last4: string | null;
  name: string | null;
  /** The pasted text (or link) the rows hold. */
  text: string;
}

export const rowsLine = (count: number) => (count === 1 ? '1 row' : `${count} rows`);

/**
 * What the picker offers for a waiting row's pasted Paid with: by last four digits, a credit card or a debit card's
 * account ending in them; by name, an account of that name; by a Notion link, a card or an account with nothing filled
 * in. `rows` counts the waiting rows (`waiting`, with their marks) still naming the same thing.
 */
export function addPaidChoices(text: string, waiting: readonly WaitingRow[], marks: Readonly<Record<string, PasteMark>>): AddPaidChoice[] {
  const key = pendingPaidKey(text);
  const rows = waiting.filter((row) => {
    const pending = pendingPaidOf(marks[row.id], row.values);
    return pending !== null && pendingPaidKey(pending) === key;
  }).length;
  if (isLinkKey(text)) {
    return [
      { kind: 'card', label: '＋ Add a credit card', rows, last4: null, name: null, text },
      { kind: 'account', label: '＋ Add a debit card or account', rows, last4: null, name: null, text },
    ];
  }
  const four = lastFourOf(text);
  if (four) {
    return [
      { kind: 'card', label: `＋ Add a credit card ending ${four}`, rows, last4: four, name: null, text },
      { kind: 'account', label: `＋ Add a debit card or account ending ${four}`, rows, last4: four, name: null, text },
    ];
  }
  const name = text.trim();
  return [{ kind: 'account', label: `＋ Add an account named ${name}`, rows, last4: null, name, text }];
}

/**
 * A card or account just added for a pasted text (`key`, its `paymentKey`): the text is remembered as it, so a later
 * paste naming it fills in, and every waiting row (`waiting`) still naming the same digits, name or link fills in now —
 * `fills` are those rows' new cells, to save as drafts. Their marks let the text go: the cell names what was added.
 */
export function fillAddedPaid(
  text: string,
  key: string,
  waiting: readonly WaitingRow[],
  store: NameStore | null = deviceStore(),
): { marks: Record<string, PasteMark>; fills: WaitingRow[] } {
  remember(PAID_KEY, text, key, store);
  const marks = readMarks(store);
  const group = pendingPaidKey(text);
  const [accountId = '', cardId = ''] = key.split(':');
  const fills: WaitingRow[] = [];
  const next: Record<string, PasteMark> = { ...marks };
  for (const row of waiting) {
    const pending = pendingPaidOf(marks[row.id], row.values);
    if (pending === null || pendingPaidKey(pending) !== group) continue;
    next[row.id] = tidy({ ...marks[row.id]!, paid: undefined, paidGuessed: undefined });
    fills.push({ id: row.id, values: { ...row.values, accountId, cardId } });
  }
  writeJson(store, MARKS_KEY, next);
  return { marks: next, fills };
}
