/*
 * Several cells at once, as a spreadsheet does (Mac Cashflow and Mac Review, owner 2026-11-18): a range of cells down
 * one column — clicked, then ⇧-clicked or dragged, or picked with Esc and the arrows (owner 2026-11-24) — copied as
 * text (⌘C), pasted into (⌘V: one value fills them all, several lines fill them in order), filled down from the top one
 * (⌘D), cleared (Delete, drafts only), or given one choice from the usual picker (Return). One blue cell takes all of
 * these but ⌘D. The blue cells are their own selection, apart from the rows ⌘-click picks.
 *
 * What a change does to a row is each table's own (its single edit's path, its refusals); here is only which cells
 * are picked, what goes into each, and how the outcome is said.
 */

/** The columns a range runs down: the ones a row's own cells edit. */
export type CellColumn = 'date' | 'description' | 'category' | 'paid' | 'amount';

export const CELL_COLUMNS: readonly CellColumn[] = ['date', 'description', 'category', 'paid', 'amount'];

/** A range down one column: from the cell first clicked (`anchor`) to the one ⇧-clicked or dragged to (`focus`). */
export interface CellRange {
  column: CellColumn;
  anchor: string;
  focus: string;
}

export const isCellColumn = (value: string | undefined | null): value is CellColumn => !!value && (CELL_COLUMNS as readonly string[]).includes(value);

/** The rows a range covers, in the table's order (`ids`). A row no longer listed drops out; with its anchor gone, so does the range. */
export function rangeIds(range: CellRange | null, ids: readonly string[]): string[] {
  if (!range) return [];
  const from = ids.indexOf(range.anchor);
  if (from < 0) return [];
  const to = ids.indexOf(range.focus);
  if (to < 0) return [range.anchor];
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** A click starts a range at its cell; ⇧-click or a drag in the same column moves the range's far end there. */
export function startRange(column: CellColumn, id: string): CellRange {
  return { column, anchor: id, focus: id };
}

export function extendRange(range: CellRange | null, column: CellColumn, id: string): CellRange {
  return range && range.column === column ? { ...range, focus: id } : startRange(column, id);
}

/** Cells copied: one per line, as a sheet's column pastes — a tab or line break inside a cell read as a space. */
export function cellsText(texts: readonly string[]): string {
  return texts.map((text) => text.replace(/[\t\r\n]+/g, ' ').trim()).join('\n');
}

/**
 * The lines of a paste into cells: one value per line (the first cell of a line copied with several), the blank line
 * a copy ends with dropped. Nothing but blanks is no paste.
 */
export function pastedLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => (line.split('\t')[0] ?? '').trim());
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.some(Boolean) ? lines : [];
}

/**
 * Which picked cell takes which value from a paste: one value fills every one of them; several fill them in order, as
 * many as both have (a longer paste stops at the range's end, a shorter one leaves the rest as they were).
 */
export function pasteAssignments(picked: readonly string[], lines: readonly string[]): { id: string; text: string }[] {
  if (picked.length === 0 || lines.length === 0) return [];
  if (lines.length === 1) return picked.map((id) => ({ id, text: lines[0]! }));
  return picked.slice(0, lines.length).map((id, i) => ({ id, text: lines[i]! }));
}

/** Why a row took no part in a change, in the words the line under the table says. */
export type SkipReason = 'read only' | 'another workspace' | 'recorded' | 'not as cells' | 'not read' | 'not saved' | 'a transfer' | 'another kind' | 'no empty date';

/** A row the change reaches: what it holds in the picked column now, or why it cannot take a change. */
export interface CellTarget<V> {
  id: string;
  /** A row waiting as not recorded (a draft), or one recorded. */
  draft: boolean;
  /** Its values now; null when it may not be changed here, and `refusal` says why. */
  values: V | null;
  refusal: SkipReason | null;
}

/** One row's change: what it held and what it is to hold, both whole, so Undo can put it back by the same path. */
export interface CellChange<V> {
  id: string;
  draft: boolean;
  before: V;
  after: V;
}

/**
 * What a change does, row by row. `next` gives a row's new values (null when the value cannot be read into this row —
 * a category no row of this kind takes, say); a row that would hold what it holds already is no change. Clearing
 * (Delete) is for drafts only: a recorded row keeps its cells.
 */
export function planChange<V>(
  targets: readonly CellTarget<V>[],
  next: (values: V, id: string) => V | null,
  same: (a: V, b: V) => boolean,
  opts: { clearing?: boolean } = {},
): { changes: CellChange<V>[]; skipped: { id: string; reason: SkipReason }[] } {
  const changes: CellChange<V>[] = [];
  const skipped: { id: string; reason: SkipReason }[] = [];
  for (const target of targets) {
    if (target.refusal || !target.values) {
      skipped.push({ id: target.id, reason: target.refusal ?? 'read only' });
      continue;
    }
    if (opts.clearing && !target.draft) {
      skipped.push({ id: target.id, reason: 'recorded' });
      continue;
    }
    const after = next(target.values, target.id);
    if (after === null) skipped.push({ id: target.id, reason: 'not read' });
    else if (!same(after, target.values)) changes.push({ id: target.id, draft: target.draft, before: target.values, after });
  }
  return { changes, skipped };
}

const REASON_WORDS: Record<SkipReason, string> = {
  'read only': 'read only',
  'another workspace': 'in another workspace',
  recorded: 'recorded (Delete clears drafts only)',
  'not as cells': 'split, income or in another currency (open it to change it)',
  'not read': 'the value does not fit',
  'not saved': 'not saved',
  'a transfer': 'a transfer has no category',
  'another kind': 'money in, not spending',
  'no empty date': 'a capture keeps its date',
};

/** "Changed 3 cells · 2 skipped: 1 read only, 1 in another workspace" — or what was skipped alone. */
export function changeLine(changed: number, skipped: readonly { reason: SkipReason }[]): string {
  const cells = `Changed ${changed} ${changed === 1 ? 'cell' : 'cells'}`;
  if (skipped.length === 0) return cells;
  const counts = new Map<SkipReason, number>();
  for (const { reason } of skipped) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const why = [...counts].map(([reason, count]) => `${count} ${REASON_WORDS[reason]}`).join(', ');
  return `${changed > 0 ? `${cells} · ` : ''}${skipped.length} skipped: ${why}`;
}

/**
 * Esc picks the cell (Notion's table, owner 2026-11-24): Esc in a cell being typed in stops the typing and leaves that
 * cell blue — what was typed kept, as leaving the row keeps it — and the keys below then work on the blue cells, one or
 * several, until Esc again lets them go. A click on a cell still types in it at once.
 *
 * A key on blue cells: what it asks for. ⌘C, ⌘V and ⌘D (Ctrl off a Mac); Delete or ⌫; Return; Esc; the arrows (with ⇧
 * up or down, the blue stretches down its column); Tab and ⇧Tab as → and ←; a letter, figure or sign starts typing in
 * the cell. Typing in a field asks for nothing — the field's own keys are its own.
 */
export type RangeKey = 'fill' | 'clear' | 'pick' | 'close' | PickMove | 'more up' | 'more down' | 'type' | null;

export type PickMove = 'up' | 'down' | 'left' | 'right';

export function rangeKey(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, typing: boolean): RangeKey {
  if (typing || event.altKey) return null;
  const command = event.metaKey || event.ctrlKey;
  if (command) return !event.shiftKey && event.key.toLowerCase() === 'd' ? 'fill' : null;
  switch (event.key) {
    case 'Backspace':
    case 'Delete':
      return 'clear';
    case 'Enter':
      return 'pick';
    case 'Escape':
      return 'close';
    case 'ArrowUp':
      return event.shiftKey ? 'more up' : 'up';
    case 'ArrowDown':
      return event.shiftKey ? 'more down' : 'down';
    // The blue stretches down one column only: ⇧← and ⇧→ ask for nothing.
    case 'ArrowLeft':
      return event.shiftKey ? null : 'left';
    case 'ArrowRight':
      return event.shiftKey ? null : 'right';
    case 'Tab':
      return event.shiftKey ? 'left' : 'right';
  }
  // One printable character (a space is not a start); a dead key or a name such as "F5" is not one.
  return [...event.key].length === 1 && event.key !== ' ' ? 'type' : null;
}

/**
 * An arrow on blue cells: one cell, the next one along from the far end of the blue (`focus`, the cell last reached).
 * Up and down go by the table's rows (`ids`), left and right by the columns this row shows (`columns`, in its order);
 * past the table's edge the blue stays where it is.
 */
export function movePick(range: CellRange, ids: readonly string[], columns: readonly CellColumn[], move: PickMove): CellRange {
  const row = ids.indexOf(range.focus);
  if (move === 'up' || move === 'down') {
    const next = ids[Math.min(Math.max(row + (move === 'up' ? -1 : 1), 0), ids.length - 1)];
    return startRange(range.column, row < 0 || !next ? range.focus : next);
  }
  const at = columns.indexOf(range.column);
  const column = at < 0 ? range.column : (columns[Math.min(Math.max(at + (move === 'left' ? -1 : 1), 0), columns.length - 1)] ?? range.column);
  return startRange(column, range.focus);
}

/** ⇧↑ or ⇧↓ on blue cells: the far end moves a row, the cell first picked stays; never past the table's edge. */
export function stretchPick(range: CellRange, ids: readonly string[], by: -1 | 1): CellRange {
  const row = ids.indexOf(range.focus);
  const next = row < 0 ? undefined : ids[Math.min(Math.max(row + by, 0), ids.length - 1)];
  return next ? { ...range, focus: next } : range;
}

/**
 * The fill square (Google Sheets', owner 2026-11-24): dragged down from the corner of the blue cells, the cells it
 * reaches below them, in the table's order — from the row under the blue down to the row under the pointer (`over`).
 * Down only: with the pointer on the blue or above it, none. A row no longer listed reaches none.
 */
export function fillReach(ids: readonly string[], picked: readonly string[], over: string | null): string[] {
  const last = picked.length > 0 ? ids.indexOf(picked[picked.length - 1]!) : -1;
  const to = over === null ? -1 : ids.indexOf(over);
  if (last < 0 || to <= last) return [];
  return ids.slice(last + 1, to + 1);
}

/**
 * The row under the pointer while the fill square is dragged, read down one column: the last of the rows whose cell
 * starts at or above the pointer (`tops`, the cells' top edges in the table's order). Past the last row it stays on the
 * last; above the first, none.
 */
export function rowAtHeight(tops: readonly { id: string; top: number }[], y: number): string | null {
  let at: string | null = null;
  for (const { id, top } of tops) {
    if (top > y) break;
    at = id;
  }
  return at;
}
