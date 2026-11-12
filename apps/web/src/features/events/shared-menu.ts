import type { SharedEventView } from '@expanses/db';
import type { CornerAction } from '../../ui/native';
import { DELETE_COPY_LABEL } from './delete-copy';
import { pageLocks, possessive } from './shared-view';

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
  if (pageLocks(view).readOnly) return [people, { key: 'delete-copy', label: DELETE_COPY_LABEL, destructive: true, run: run.deleteCopy }];
  const owes = (view.people.find((p) => p.isMe)?.balanceMinor ?? 0) !== 0;
  return [
    people,
    { key: 'categories', label: 'Categories', run: run.categories },
    { key: 'done', label: view.finishedAt ? 'Reopen' : 'Done', run: () => run.done(view.finishedAt === null) },
    { key: 'leave', label: 'Leave', destructive: true, run: run.leave, disabled: owes, ...(owes ? { detail: `${possessive(view.myName)} balance is not zero yet` } : {}) },
  ];
}
