import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, Plus, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { MORE_GROUPS, type NavItem, SETTINGS_ITEMS } from '../../app/nav';
import { isNative } from '../../lib/pwa';
import { ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, ROW_PAD_X, ROW_PAD_Y, SCREEN, TAP } from '../../ui/native';
import { daysSince, getLastBackupAt } from '../backup/backupState';
import { usePendingDraftCount } from '../review/queries';
import { NewWorkspaceSheet } from '../workspaces/NewWorkspaceSheet';
import { useArchivedBooks, useBooks } from '../workspaces/queries';
import { WorkspaceDot } from '../workspaces/WorkspaceBadge';

/** How long ago the last backup was, in the fewest words that still answer "am I covered?". */
function backupNote(last: string | null): string {
  if (!last) return 'never';
  const days = daysSince(last);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * An open workspace's line: its round letter and its name, on one line. Two targets, side by side and never one
 * inside the other — the body switches to the workspace and the › opens its own page.
 */
function WorkspaceLine({
  position,
  book,
  current,
  busy,
  onSwitch,
}: GroupChild & { book: { id: string; name: string; kind: string }; current: boolean; busy: boolean; onSwitch: () => void }) {
  return (
    <div className="relative flex items-stretch" data-testid="account-workspace" style={{ minHeight: TAP }}>
      {position?.separator && (
        <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X + 28 + 10, right: ROW_PAD_X }} />
      )}
      <button
        type="button"
        data-testid="workspace-switch"
        aria-label={book.name}
        aria-current={current ? 'true' : undefined}
        disabled={busy}
        onClick={onSwitch}
        className="ph-focus-inset flex min-w-0 flex-1 items-center text-left"
        style={{ gap: 10, padding: `${ROW_PAD_Y}px 0 ${ROW_PAD_Y}px ${ROW_PAD_X}px` }}
      >
        <span className="flex w-7 shrink-0 justify-center">
          <WorkspaceDot book={book} />
        </span>
        <span className="block min-w-0 flex-1 truncate text-[17px] leading-[22px] font-medium text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]">{book.name}</span>
        {current && <Check size={18} aria-label="Open" className="shrink-0 text-[var(--ph-tint)]" />}
      </button>
      <Link
        to="/account/workspaces/$bookId"
        params={{ bookId: book.id }}
        aria-label={`Open ${book.name}`}
        data-testid="workspace-open"
        className="ph-focus-inset flex shrink-0 items-center justify-end"
        style={{ minWidth: TAP, paddingRight: ROW_PAD_X }}
      >
        <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
          {'›'}
        </span>
      </Link>
    </div>
  );
}

/**
 * The Account page: a main page of the menu, so it has no way back. The workspaces, then the settings, then
 * everything the tab bar cannot hold.
 */
export function AccountMenuPage() {
  const { database, ws, switchBook } = useApp();
  const books = useBooks();
  const archived = useArchivedBooks();
  const pending = usePendingDraftCount().data ?? 0;
  const lastBackup = useQuery({ queryKey: ['last-backup'], queryFn: () => getLastBackupAt(database) });
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function choose(bookId: string) {
    if (bookId === ws.bookId) return;
    setBusy(true);
    setError(null);
    try {
      await switchBook(bookId);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const note = (to: string) => {
    if (to === '/backup') return lastBackup.isSuccess ? backupNote(lastBackup.data) : undefined;
    if (to === '/review' && pending > 0) return `${pending} waiting`;
    return undefined;
  };
  const rows = (items: readonly NavItem[]) =>
    items.map((item) => <InsetRow key={item.to} icon={<item.icon size={16} aria-hidden />} title={item.label} subtitle={item.note} value={note(item.to)} to={item.to} />);

  return (
    <div className={SCREEN}>
      <div className="flex flex-col items-center pt-[14px] pb-[18px]">
        <span aria-hidden className="flex h-[84px] w-[84px] items-center justify-center rounded-full bg-[var(--ph-corner)] text-[var(--ph-ink-3)]">
          <UserRound size={42} strokeWidth={1.7} />
        </span>
        <h1 className="mt-[10px] text-[24px] leading-[30px] font-semibold tracking-tight text-[var(--ph-ink)]">Account</h1>
      </div>

      <ErrorBox error={error} />
      <InsetGroup header="Workspaces">
        {[
          ...(books.data ?? []).map((book) => (
            <WorkspaceLine key={book.id} book={book} current={book.id === ws.bookId} busy={busy} onSwitch={() => void choose(book.id)} />
          )),
          ...(archived.data ?? []).map((book) => (
            <InsetRow
              key={book.id}
              testId="archived-workspace"
              icon={<WorkspaceDot book={book} />}
              title={<span className="text-[var(--ph-ink-3)]">{book.name}</span>}
              value="Archived"
              to="/account/workspaces/$bookId"
              params={{ bookId: book.id }}
              label={`Open ${book.name}, archived`}
            />
          )),
          <InsetRow key="new" testId="new-workspace" icon={<Plus size={16} aria-hidden />} title="New workspace" chevron={false} onClick={() => setCreating(true)} />,
        ]}
      </InsetGroup>

      <InsetGroup header="Settings">{rows(SETTINGS_ITEMS.filter((item) => item.to !== '/settings/capture' || isNative()))}</InsetGroup>

      {MORE_GROUPS.map((group) => (
        <InsetGroup key={group.title} header={group.title}>
          {rows(group.items)}
        </InsetGroup>
      ))}

      {creating && <NewWorkspaceSheet onClose={() => setCreating(false)} />}
    </div>
  );
}
