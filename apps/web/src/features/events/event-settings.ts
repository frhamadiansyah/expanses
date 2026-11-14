import { namesOf } from '../sharing/net-worth-state';

/** The sentence under Money: both locks, said once whether either is on or not. */
export const MONEY_FOOTER = 'Categories stay once something is tagged or planned. Currency stays once something is bought.';

/** The sentence under Plan. */
export const PLAN_FOOTER = 'A list of what to buy, and the “Against the plan” page.';

/** The sentence under Delete event, and the second half of its confirm. */
export const DELETE_FOOTER = 'Its transactions stay where they are.';

/** The sentence under the "Shared with …" switch: what turning it on does. */
export function shareFooter(others: readonly string[]): string {
  const names = namesOf(others) || 'The household';
  return `On: ${names} ${others.length > 1 ? 'see' : 'sees'} the event and ${others.length > 1 ? 'add' : 'adds'} to it.`;
}

/** "15 Dec": the day an event was called done, in the reader's own time zone. */
export function doneDay(finishedAt: string): string {
  return new Date(finishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * The finishing row: Mark as done while the event is open, Reopen once it is done, and the sentence under it.
 *
 * The Events list puts an event in Past when it is done OR its last day has gone by, so an event that has already
 * ended is in Past either way: its sentence says so rather than promising a move that will not happen.
 */
export function finishRow(event: { name: string; endsOn: string; finishedAt: string | null }, today: string): { label: string; footer: string } {
  const ended = event.endsOn < today;
  if (event.finishedAt === null) {
    return { label: 'Mark as done', footer: ended ? `${event.name} has ended and is already in Past.` : `Moves ${event.name} to Past. It can be reopened.` };
  }
  const day = doneDay(event.finishedAt);
  return { label: 'Reopen', footer: ended ? `Done on ${day}. It has ended, so it stays in Past.` : `Done on ${day}. Reopening moves it back to Now and next.` };
}
