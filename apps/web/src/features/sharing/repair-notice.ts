import type { RepairNotice, RepairNoticeRow } from '@expanses/db';

/*
 * The one-time notice the shared-book repairs leave (sync gaps R2): Family purchases that were tagged to an event
 * without being moved there, put right so both phones count them the same. Impersonal words only (the owner's rule).
 */

const purchases = (n: number) => `${n} ${n === 1 ? 'purchase' : 'purchases'}`;

/** The notice's title. */
export function repairTitle(notice: RepairNotice): string {
  const n = notice.rows.length;
  return `${purchases(n)} in ${notice.bookName} ${n === 1 ? 'was' : 'were'} tagged to an event without being moved`;
}

/** The one line under it: what was done, and that both phones now agree. */
export function repairLine(notice: RepairNotice): string {
  const moved = notice.rows.filter((row) => row.outcome === 'moved').length;
  const back = notice.rows.length - moved;
  const parts = [
    ...(moved > 0 ? [`${moved} moved into ${moved === 1 ? 'its' : 'their'} shared event`] : []),
    ...(back > 0 ? [`${back} ${back === 1 ? 'shows' : 'show'} in ${notice.bookName} again`] : []),
  ];
  return `${parts.join(', ')}. The same on both phones now.`;
}

/** One row of the list, in a sentence. */
export function repairRowText(row: RepairNoticeRow, bookName: string): string {
  const what = row.description.trim() || 'A purchase';
  if (row.outcome === 'moved') return `${what} moved into ${row.eventName}`;
  if (row.why) return `${what} could not be moved into ${row.eventName}: ${row.why}. It shows in ${bookName} again.`;
  return `${what} is no longer tagged to ${row.eventName}, and shows in ${bookName} again.`;
}
