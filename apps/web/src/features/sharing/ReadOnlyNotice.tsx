import { useApp } from '../../app/context';
import { Notice } from '../../ui/native';
import { useSharedBooks } from './queries';
import { endedLine, READ_ONLY_NOTE } from './sharing-copy';

/**
 * Above every screen of a workspace whose sharing ended here (spec §8.6): who ended it, and that it is kept read-only.
 * Nothing on it can be added or changed — capture refuses the write — so the screen says so before anyone tries.
 */
export function ReadOnlyNotice() {
  const { ws } = useApp();
  const book = (useSharedBooks().data ?? []).find((each) => each.bookId === ws.bookId && each.state === 'unshared');
  if (!book) return null;
  const byName = book.members.find((member) => member.memberId === book.unsharedBy)?.name ?? null;
  return (
    <Notice
      testId="read-only-notice"
      kind="info"
      title={endedLine({ byName, byYou: book.unsharedBy !== null && book.unsharedBy === book.memberId, removed: book.unsharedReason === 'removed' })}
      line="Kept read-only"
      body={READ_ONLY_NOTE}
    />
  );
}
