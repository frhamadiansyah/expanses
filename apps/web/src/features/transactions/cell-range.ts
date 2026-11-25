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

/**
 * A range down one column: from the cell first clicked (`anchor`) to the one ⇧-clicked or dragged to (`focus`) — or,
 * once ⌘-click has added or taken out a cell (owner 2026-11-24), the cells it holds (`ids`), next to each other or
 * not; `focus` is then the cell last ⌘-clicked.
 */
export interface CellRange {
  column: CellColumn;
  anchor: string;
  focus: string;
  ids?: readonly string[];
  /**
   * A block across columns (owner 2026-11-25, as Sheets): the far column a drag or ⇧→ reached, the block running from
   * `column` to it in the table's order. Absent for one column.
   */
  toColumn?: CellColumn;
}

/** The columns a range covers, in the table's order: its own, or every one from its column to the far one. */
export function rangeColumns(range: CellRange | null): CellColumn[] {
  if (!range) return [];
  if (!range.toColumn || range.toColumn === range.column) return [range.column];
  const from = CELL_COLUMNS.indexOf(range.column);
  const to = CELL_COLUMNS.indexOf(range.toColumn);
  return CELL_COLUMNS.slice(Math.min(from, to), Math.max(from, to) + 1);
}

export const isCellColumn = (value: string | undefined | null): value is CellColumn => !!value && (CELL_COLUMNS as readonly string[]).includes(value);

/** The rows a range covers, in the table's order (`ids`). A row no longer listed drops out; with its anchor gone, so does the range. */
export function rangeIds(range: CellRange | null, ids: readonly string[]): string[] {
  if (!range) return [];
  if (range.ids) {
    const held = new Set(range.ids);
    return ids.filter((id) => held.has(id));
  }
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
  if (!range) return startRange(column, id);
  // In another column, a block from the cell first picked to this one (owner 2026-11-25).
  return column === range.column ? { column, anchor: range.anchor, focus: id } : { column: range.column, anchor: range.anchor, focus: id, toColumn: column };
}

/**
 * ⇧→ or ⇧← on blue cells (owner 2026-11-25): the block's far column moves one along the columns the row shows
 * (`columns`, in its order), the rows kept; back to the first column, one column again. Never past either end.
 */
export function stretchColumns(range: CellRange, columns: readonly CellColumn[], by: -1 | 1): CellRange {
  const far = range.toColumn ?? range.column;
  const at = columns.indexOf(far);
  if (at < 0) return range;
  const next = columns[Math.min(Math.max(at + by, 0), columns.length - 1)]!;
  const { ids: _apart, toColumn: _far, ...run } = range;
  return next === range.column ? run : { ...run, toColumn: next };
}

/**
 * ⌘-click on a cell while cells are picked: in their column it adds the cell, or takes it out, wherever it sits (the
 * cells need not be next to each other); in another column it starts again there. Null when the last one is taken out.
 */
export function togglePick(range: CellRange | null, ids: readonly string[], column: CellColumn, id: string): CellRange | null {
  if (!range || range.column !== column || range.toColumn) return startRange(column, id);
  const now = rangeIds(range, ids);
  const next = now.includes(id) ? now.filter((one) => one !== id) : ids.filter((one) => one === id || now.includes(one));
  if (next.length === 0) return null;
  return { column, anchor: next[0]!, focus: now.includes(id) ? next[next.length - 1]! : id, ids: next };
}

/** Cells copied: one per line, as a sheet's column pastes — a tab or line break inside a cell read as a space. */
export function cellsText(texts: readonly string[]): string {
  return texts.map((text) => text.replace(/[\t\r\n]+/g, ' ').trim()).join('\n');
}

/** A block copied (owner 2026-11-25): a row per line, its cells apart by tabs — what Sheets and Notion paste as a table. */
export function blockText(rows: readonly (readonly string[])[]): string {
  return rows.map((cells) => cells.map((text) => text.replace(/[\t\r\n]+/g, ' ').trim()).join('\t')).join('\n');
}

/** A paste read as a block: a row per line, a cell per tab; the blank line a copy ends with dropped. Nothing but blanks is none. */
export function pastedGrid(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.split('\t').map((cell) => cell.trim()));
  while (rows.length > 0 && rows[rows.length - 1]!.every((cell) => cell === '')) rows.pop();
  return rows.some((row) => row.some(Boolean)) ? rows : [];
}

/** One cell a paste fills: the row, the column, the words. */
export interface CellAssignment {
  id: string;
  column: CellColumn;
  text: string;
}

/**
 * Which cells a paste fills (owner 2026-11-25): one value fills every picked cell; otherwise the paste is laid from the
 * picked block's top-left cell — down the picked rows (stopping at their end, as one column always did) and across as
 * many columns as it has, from the block's first column on (`columns`, the table's from there), so a two-column copy
 * fills two columns at once.
 */
export function gridAssignments(picked: readonly string[], pickedColumns: readonly CellColumn[], columns: readonly CellColumn[], grid: readonly (readonly string[])[]): CellAssignment[] {
  if (picked.length === 0 || grid.length === 0 || pickedColumns.length === 0) return [];
  if (grid.length === 1 && grid[0]!.length === 1) return picked.flatMap((id) => pickedColumns.map((column) => ({ id, column, text: grid[0]![0]! })));
  const from = columns.indexOf(pickedColumns[0]!);
  const across = from < 0 ? [pickedColumns[0]!] : columns.slice(from);
  return picked.slice(0, grid.length).flatMap((id, i) => grid[i]!.slice(0, across.length).map((text, j) => ({ id, column: across[j]!, text })));
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
 * the cell; ⌘Return records the rows the picked cells are in. Typing in a field asks for nothing — the field's own keys
 * are its own.
 */
export type RangeKey = 'fill' | 'clear' | 'pick' | 'close' | 'record' | PickMove | 'more up' | 'more down' | 'more left' | 'more right' | 'type' | 'look' | PickJump | 'more first' | 'more last' | 'column' | null;

export type PickMove = 'up' | 'down' | 'left' | 'right';

/** ⌘↑ ⌘↓: the column's first or last row; Home and End: the row's first or last cell (owner 2026-11-25). */
export type PickJump = 'first' | 'last' | 'home' | 'end';

export function rangeKey(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, typing: boolean): RangeKey {
  if (typing || event.altKey) return null;
  const command = event.metaKey || event.ctrlKey;
  if (command) {
    // ⇧⌘↑ ⇧⌘↓ stretch the blue to the column's first or last row; nothing else with ⇧.
    if (event.shiftKey) return event.key === 'ArrowUp' ? 'more first' : event.key === 'ArrowDown' ? 'more last' : null;
    // ⌘Return records the rows of the picked cells (owner, 2026-11-24: plain Return only ends a cell's typing).
    if (event.key === 'Enter') return 'record';
    if (event.key === 'ArrowUp') return 'first';
    if (event.key === 'ArrowDown') return 'last';
    const letter = event.key.toLowerCase();
    // ⌘A picks the whole column, the rows shown (owner 2026-11-25).
    return letter === 'd' ? 'fill' : letter === 'a' ? 'column' : null;
  }
  switch (event.key) {
    case 'Backspace':
    case 'Delete':
      return 'clear';
    case 'Enter':
      return 'pick';
    case 'Escape':
      return 'close';
    // Space is Finder's quick look (owner 2026-11-25): the row's panel, opened or closed.
    case ' ':
      return event.shiftKey ? null : 'look';
    case 'Home':
      return event.shiftKey ? null : 'home';
    case 'End':
      return event.shiftKey ? null : 'end';
    case 'ArrowUp':
      return event.shiftKey ? 'more up' : 'up';
    case 'ArrowDown':
      return event.shiftKey ? 'more down' : 'down';
    // ⇧← and ⇧→ stretch the blue across the columns: a block (owner 2026-11-25).
    case 'ArrowLeft':
      return event.shiftKey ? 'more left' : 'left';
    case 'ArrowRight':
      return event.shiftKey ? 'more right' : 'right';
    case 'Tab':
      return event.shiftKey ? 'left' : 'right';
  }
  // One printable character (a space is not a start); a dead key or a name such as "F5" is not one.
  return [...event.key].length === 1 && event.key !== ' ' ? 'type' : null;
}

/**
 * A jump on blue cells (owner 2026-11-25): ⌘↑ ⌘↓ one cell, the column's first or last row; Home and End one cell, the
 * row's first or last column (`columns`, the ones this row shows). An empty table leaves the blue where it is.
 */
export function jumpPick(range: CellRange, ids: readonly string[], columns: readonly CellColumn[], jump: PickJump): CellRange {
  if (jump === 'first' || jump === 'last') {
    const id = jump === 'first' ? ids[0] : ids[ids.length - 1];
    return id ? startRange(range.column, id) : range;
  }
  const column = jump === 'home' ? columns[0] : columns[columns.length - 1];
  return startRange(column ?? range.column, range.focus);
}

/** ⇧⌘↑ ⇧⌘↓: the far end to the column's first or last row, the cell first picked staying. */
export function stretchTo(range: CellRange, ids: readonly string[], end: 'first' | 'last'): CellRange {
  const id = end === 'first' ? ids[0] : ids[ids.length - 1];
  return id ? { column: range.column, anchor: range.anchor, focus: id, ...(range.toColumn ? { toColumn: range.toColumn } : {}) } : range;
}

/** ⌘A: every cell of the column, the rows the table shows. */
export function columnPick(range: CellRange, ids: readonly string[]): CellRange {
  const first = ids[0];
  const last = ids[ids.length - 1];
  return first && last ? { column: range.column, anchor: first, focus: last, ...(range.toColumn ? { toColumn: range.toColumn } : {}) } : range;
}

/**
 * An arrow on blue cells: one cell, the next one along from the far end of the blue (`focus`, the cell last reached).
 * Up and down go by the table's rows (`ids`), left and right by the columns this row shows (`columns`, in its order);
 * past the table's edge the blue stays where it is.
 */
export function movePick(range: CellRange, ids: readonly string[], columns: readonly CellColumn[], move: PickMove): CellRange {
  const row = ids.indexOf(range.focus);
  // From a block, the arrows go on from its far corner: the row last reached, the column last reached.
  const far = range.toColumn ?? range.column;
  if (move === 'up' || move === 'down') {
    const next = ids[Math.min(Math.max(row + (move === 'up' ? -1 : 1), 0), ids.length - 1)];
    return startRange(far, row < 0 || !next ? range.focus : next);
  }
  const at = columns.indexOf(far);
  const column = at < 0 ? far : (columns[Math.min(Math.max(at + (move === 'left' ? -1 : 1), 0), columns.length - 1)] ?? far);
  return startRange(column, range.focus);
}

/** ⇧↑ or ⇧↓ on blue cells: the far end moves a row, the cell first picked stays; never past the table's edge. */
export function stretchPick(range: CellRange, ids: readonly string[], by: -1 | 1): CellRange {
  const row = ids.indexOf(range.focus);
  const next = row < 0 ? undefined : ids[Math.min(Math.max(row + by, 0), ids.length - 1)];
  // Cells ⌘-clicked apart become one run again: from the first picked to the far end, moved. A block keeps its columns.
  return next ? { column: range.column, anchor: range.anchor, focus: next, ...(range.toColumn ? { toColumn: range.toColumn } : {}) } : range;
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
