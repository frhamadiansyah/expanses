/**
 * What a phone does with a table, and the one question that decides it: **does a row have somewhere to go?**
 *
 * "A table becomes rows on a phone and stays a table on desktop" is the kit's rule, and it works because the
 * columns the row drops are waiting on the detail screen behind the chevron. Where there is no detail screen —
 * `/net-worth/trades` has none for a holding, `/net-worth/loans/$accountId` none for a schedule line — that
 * second half of the rule is not true, and collapsing the table puts average cost, unrealized, realized this
 * year, income this year and "Left after" **on no screen at all**. Losing a column is worse than scrolling one.
 *
 * So the table is told, never left to infer: a caller declares whether opening a record leads anywhere, and a
 * table with nowhere to send a reader keeps every column on the phone too, inside its own sideways scroller —
 * which is the one exception the app's layout rule already grants a table, a diagram or a block of code.
 */

/** What the phone draws: a row per record, or the table itself. */
export type PhoneForm = 'rows' | 'table';

/**
 * Where the columns a row cannot hold are reached.
 *
 * `detail` — opening the record opens a screen that holds them. `none` — there is no such screen, so nothing
 * may be dropped.
 */
export type RecordDestination = 'detail' | 'none';

export interface RecordTablePlan {
  form: PhoneForm;
  /** True when the table is drawn at its natural width and scrolls sideways inside its own container. */
  scrolls: boolean;
  /** The column keys on screen without opening anything, in the order the columns were given. */
  drawn: string[];
  /** The column keys reached by opening a record. Empty unless there is a record to open. */
  behindChevron: string[];
}

/**
 * How `columns` are placed at this width.
 *
 * A wide screen always keeps the whole table — desktop is the paid tier and is never the poor relation. A phone
 * keeps the whole table too unless a detail screen exists to hold what a row would drop.
 */
export function planRecordTable(
  columns: readonly { key: string }[],
  options: { phone: boolean; destination: RecordDestination; onRow?: readonly string[] },
): RecordTablePlan {
  const keys = columns.map((column) => column.key);
  if (!options.phone) return { form: 'table', scrolls: false, drawn: keys, behindChevron: [] };
  if (options.destination === 'none') return { form: 'table', scrolls: true, drawn: keys, behindChevron: [] };
  const onRow = new Set(options.onRow ?? []);
  return {
    form: 'rows',
    scrolls: false,
    drawn: keys.filter((key) => onRow.has(key)),
    behindChevron: keys.filter((key) => !onRow.has(key)),
  };
}

/**
 * Every column a reader can get to: the ones drawn, plus the ones an open record shows.
 *
 * The rule the whole restyle is held to is that no field is lost, so this must always come back equal to the
 * columns that went in. It is a function rather than a comment because that is the only form of it a test can
 * fail on.
 */
export function reachableColumns(plan: RecordTablePlan): string[] {
  return [...plan.drawn, ...plan.behindChevron];
}
