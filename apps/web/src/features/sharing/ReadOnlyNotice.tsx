import { useApp } from '../../app/context';
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
    <p role="status" data-testid="read-only-notice" className="mb-3 rounded-[10px] bg-[var(--ph-surface)] px-[13px] py-[10px] text-[13px] leading-[18px] text-[var(--ph-ink-2)]">
      <span className="font-semibold text-[var(--ph-ink)]">{endedLine({ byName, byYou: book.unsharedBy !== null && book.unsharedBy === book.memberId, removed: book.unsharedReason === 'removed' })}.</span> {READ_ONLY_NOTE}
    </p>
  );
}
