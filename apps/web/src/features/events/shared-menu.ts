import type { SharedEventView } from '@expanses/db';
import type { CornerAction } from '../../ui/native';
import { DELETE_COPY_LABEL } from './delete-copy';
import { pageLocks, possessive, signedBalance } from './shared-view';

/**
 * A shared event's ⋯ menu (shared events §6): People; Categories; Done (or Reopen); Leave, at a
 * zero balance only (D9). A line that cannot be taken yet stays in the menu, greyed, saying why.
 *
 * There is no Currency line: the currency is chosen in the Share sheet and fixed once shared. An event this phone's person is no longer
 * in keeps People, to read, and Delete this copy (this phone alone): everything else would only be offered to be refused (I5).
 */
export function sharedEventMenu(
  view: SharedEventView,
  run: { people(): void; categories(): void; done(finished: boolean): void; leave(): void; deleteCopy(): void },
): CornerAction[] {
  const people: CornerAction = { key: 'people', label: 'People', run: run.people };
  const balance = view.people.find((p) => p.isMe)?.balanceMinor ?? 0;
  const owes = balance !== 0;
  if (pageLocks(view).readOnly) {
    // Waiting for an invite, the person is still in the event: the copy comes back to life with one (review minor 2).
    if (view.state === 'needs_invite') return [people];
    // The copy is the only account here of a balance not at zero (review I1): kept, saying how much.
    const detail = owes ? { detail: `${possessive(view.myName)} balance is ${signedBalance(balance, view.currency)}` } : {};
    return [people, { key: 'delete-copy', label: DELETE_COPY_LABEL, destructive: true, run: run.deleteCopy, disabled: owes, ...detail }];
  }
  return [
    people,
    { key: 'categories', label: 'Categories', run: run.categories },
    { key: 'done', label: view.finishedAt ? 'Reopen' : 'Done', run: () => run.done(view.finishedAt === null) },
    { key: 'leave', label: 'Leave', destructive: true, run: run.leave, disabled: owes, ...(owes ? { detail: `${possessive(view.myName)} balance is not zero yet` } : {}) },
  ];
}
