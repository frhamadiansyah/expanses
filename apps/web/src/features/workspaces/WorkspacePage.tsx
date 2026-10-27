import { CURRENCIES, isoDate } from '@expanses/core';
import { applyCategoryStart, archiveBook, BookError, type BookDeletePlan, type BookKind, type BookRow, deleteBook, findRate, planBookDelete, renameBook, restoreBook, setBookBaseCurrency, setBookEventsInBudget, setBookKind } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check, Coins, Layers, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, PushedTitle, ReadOnlyRow, SCREEN, SubmitRow, SwitchRow, TextRow } from '../../ui/native';
import { useSharedBooks } from '../sharing/queries';
import { ShareRow } from '../sharing/SharingSection';
import { BusinessListAlert } from './BusinessListAlert';
import { DeleteWorkspaceSheet } from './DeleteWorkspaceSheet';
import { useArchivedBooks, useBooks } from './queries';

export const KIND_LABEL: Record<string, string> = { personal: 'Personal', business: 'Business', family: 'Family', shared: 'Shared' };
const CHOOSABLE: readonly BookKind[] = ['personal', 'business', 'family'];

/** The choice of type: a short list, the current one ticked. */
function TypeSheet({ current, onChoose, onClose }: { current: BookKind; onChoose: (kind: BookKind) => void; onClose: () => void }) {
  return (
    <Sheet title="Type" onClose={onClose} grouped>
      <InsetGroup wide>
        {CHOOSABLE.map((kind) => (
          <InsetRow
            key={kind}
            testId={`type-${kind}`}
            title={KIND_LABEL[kind]}
            value={kind === current ? <Check size={18} aria-label="Current" /> : undefined}
            valueTone="ink"
            chevron={false}
            onClick={() => onChoose(kind)}
          />
        ))}
      </InsetGroup>
    </Sheet>
  );
}

/** The rename: one field and a Save, the same rules as before (not empty, changed, Enter submits). */
function NameSheet({ current, busy, onSave, onClose }: { current: string; busy: boolean; onSave: (name: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(current);
  const ok = !busy && draft.trim() !== '' && draft.trim() !== current;
  return (
    <Sheet title="Name" onClose={onClose} grouped>
      <form
        aria-label="Rename workspace"
        onSubmit={(event) => {
          event.preventDefault();
          if (ok) onSave(draft);
        }}
      >
        <InsetGroup wide>
          <TextRow label="Name" value={draft} onChange={(event) => setDraft(event.target.value)} enterKeyHint="done" autoFocus />
        </InsetGroup>
        <InsetGroup wide>
          <SubmitRow label="Save" disabled={!ok} />
        </InsetGroup>
      </form>
    </Sheet>
  );
}

/** The choice of currency: every code, the current one ticked. */
function CurrencySheet({ current, onChoose, onClose }: { current: string; onChoose: (code: string) => void; onClose: () => void }) {
  return (
    <Sheet title="Currency" onClose={onClose} grouped>
      <InsetGroup wide>
        {CURRENCIES.map((option) => (
          <InsetRow
            key={option.code}
            testId={`currency-${option.code}`}
            title={option.code}
            subtitle={option.name}
            value={option.code === current ? <Check size={18} aria-label="Current" /> : undefined}
            valueTone="ink"
            chevron={false}
            onClick={() => onChoose(option.code)}
          />
        ))}
      </InsetGroup>
    </Sheet>
  );
}

/**
 * One workspace's own page: what it is called, its type, what it reads in, whether an event counts against its
 * budget, who it is shared with, and the way to put it away (or, once archived, to bring it back).
 *
 * Changing a currency is agreed to with the rate in front of the owner, because it rewrites every cap the workspace
 * holds; archiving asks twice, as deleting a row does, since the first press of a destructive button is as often a
 * mis-tap as it is a decision. The name is changed in its own small sheet.
 */
export function WorkspacePage() {
  const { bookId } = useParams({ from: '/account/workspaces/$bookId' });
  const books = useBooks();
  const archived = useArchivedBooks();
  const book = [...(books.data ?? []), ...(archived.data ?? [])].find((each) => each.id === bookId);
  if (!book) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Workspace" back="Account" backTo="/account" />
        {books.isSuccess && archived.isSuccess && (
          <InsetGroup wide>
            <InsetRow title="That workspace is not here." chevron={false} />
          </InsetGroup>
        )}
      </div>
    );
  }
  // Keyed by the workspace and its state, so the drafts start again from what was just saved.
  return <WorkspaceDetail key={`${book.id}:${book.archivedAt ?? ''}`} book={book} />;
}

function WorkspaceDetail({ book }: { book: BookRow }) {
  const { database, ws, switchBook } = useApp();
  const books = useBooks();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const [renaming, setRenaming] = useState(false);
  const [choosingCurrency, setChoosingCurrency] = useState(false);
  const [currency, setCurrency] = useState(book.baseCurrency);
  const [armed, setArmed] = useState(false);
  // Delete asks once for an empty workspace (armed) and opens the typed-name sheet for one that holds transactions.
  const [armedDelete, setArmedDelete] = useState(false);
  const [deleting, setDeleting] = useState<BookDeletePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosingType, setChoosingType] = useState(false);
  const [offering, setOffering] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const isArchived = book.archivedAt !== null;
  // A shared workspace keeps the currency and the type it was shared in (sharing spec §6.5 step 0): neither row is
  // offered, and the repository refuses both anyway.
  const shared = book.kind === 'shared' || (useSharedBooks().data ?? []).some((each) => each.bookId === book.id);
  // The only Personal workspace stays Personal: it is where categories and expected income fall back to.
  const onlyPersonal = book.kind === 'personal' && !(books.data ?? []).some((other) => other.kind === 'personal' && other.id !== book.id);

  // What today's rate would do, read before anything is written: a plan converted at a rate nobody was shown is
  // a plan nobody can check.
  const rate = useQuery({
    queryKey: ['book-currency-rate', ws.workspaceId, book.baseCurrency, currency],
    enabled: currency !== book.baseCurrency,
    queryFn: async () => (await findRate(database, book.baseCurrency, currency, isoDate())) ?? null,
  });

  async function run(work: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await work());
      // Every screen reads through the workspace, so every screen is stale the moment one of these lands.
      await invalidate();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const rename = (name: string) => {
    setRenaming(false);
    void run(async () => {
      await renameBook(database, ws, book.id, name);
      return `Now called ${name.trim()}.`;
    });
  };

  const changeKind = (kind: BookKind) => {
    setChoosingType(false);
    if (kind === book.kind || busy) return;
    void run(async () => {
      await setBookKind(database, ws, book.id, kind);
      // Offered once, as the type becomes Business; Settings keeps the same action for later.
      if (kind === 'business' && !shared) setOffering(true);
      return null;
    });
  };

  const useBusinessList = () =>
    run(async () => {
      await applyCategoryStart(database, ws, { bookId: book.id, start: 'business' });
      return 'Business list added';
    });

  const changeCurrency = () =>
    run(async () => {
      const done = await setBookBaseCurrency(database, ws, book.id, currency);
      return `Converted at ${done.rate} from ${done.onDate}.`;
    });

  const setEvents = (on: boolean) =>
    run(async () => {
      await setBookEventsInBudget(database, ws, book.id, on);
      return null;
    });

  const archive = () =>
    run(async () => {
      await archiveBook(database, ws, book.id);
      // The app cannot stay in a workspace that has just been put away: it falls back to Personal, as every
      // other fallback in the app does.
      if (book.id === ws.bookId) {
        const rest = (books.data ?? []).filter((other) => other.id !== book.id);
        const next = rest.find((other) => other.kind === 'personal') ?? rest[0];
        if (next) await switchBook(next.id);
      }
      void navigate({ to: '/account' });
      return null;
    });

  const restore = () =>
    run(async () => {
      await restoreBook(database, ws, book.id);
      void navigate({ to: '/account' });
      return null;
    });

  // The app cannot stay in a workspace that has just gone: it falls back to Personal, as every other fallback does.
  const leave = async () => {
    if (book.id === ws.bookId) {
      const rest = (books.data ?? []).filter((other) => other.id !== book.id);
      const next = rest.find((other) => other.kind === 'personal') ?? rest[0];
      if (next) await switchBook(next.id);
    }
    void navigate({ to: '/account' });
  };

  const remove = () =>
    run(async () => {
      if (armedDelete) {
        await deleteBook(database, ws, book.id);
        await leave();
        return null;
      }
      const plan = await planBookDelete(database, ws, book.id);
      if (plan.refusal) throw new BookError(plan.refusalCode ?? 'IN_USE', plan.refusal);
      if (plan.empty) setArmedDelete(true);
      else setDeleting(plan);
      return null;
    });

  return (
    <div className={SCREEN}>
      <PushedTitle title={book.name} back="Account" backTo="/account" />
      <div className="pt-[2px]">
        <ErrorBox error={error} />
        {note && <p className="pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-tint)]">{note}</p>}

        {isArchived ? (
          <>
            <InsetGroup wide>
              <ReadOnlyRow label="Name" value={book.name} />
              <ReadOnlyRow label="Type" value={KIND_LABEL[book.kind] ?? book.kind} />
              <ReadOnlyRow label="Currency" value={book.baseCurrency} />
              <ReadOnlyRow label="Status" value="Archived" />
            </InsetGroup>
            <InsetGroup wide>
              <DestructiveRow calm testId="restore-workspace" label="Restore" onClick={() => !busy && void restore()} />
              <DestructiveRow testId="delete-workspace" label={armedDelete ? 'Click again to delete' : 'Delete'} onClick={() => !busy && void remove()} />
            </InsetGroup>
          </>
        ) : (
          <>
            <InsetGroup wide>
              <InsetRow
                testId="ws-name-row"
                icon={<Pencil size={15} aria-hidden />}
                title="Name"
                value={book.name}
                disabled={busy}
                onClick={() => setRenaming(true)}
              />
              {shared || onlyPersonal ? (
                <InsetRow icon={<Layers size={15} aria-hidden />} title="Type" value={KIND_LABEL[book.kind] ?? book.kind} chevron={false} />
              ) : (
                <InsetRow testId="ws-type-row" icon={<Layers size={15} aria-hidden />} title="Type" value={KIND_LABEL[book.kind] ?? book.kind} onClick={() => setChoosingType(true)} />
              )}
              {shared ? (
                <InsetRow icon={<Coins size={15} aria-hidden />} title="Currency" value={book.baseCurrency} chevron={false} />
              ) : (
                <InsetRow testId="ws-currency-row" icon={<Coins size={15} aria-hidden />} title="Currency" value={currency} onClick={() => setChoosingCurrency(true)} />
              )}
            </InsetGroup>

            {!shared && currency !== book.baseCurrency && (
              <InsetGroup
                wide
                footer={
                  rate.isSuccess ? (
                    <span data-testid="currency-note" className={rate.data ? undefined : 'text-[var(--ph-warn)]'}>
                      {rate.data
                        ? `Caps and expected income will be converted at ${rate.data.rate} from ${rate.data.onDate}`
                        : `No ${book.baseCurrency}→${currency} rate yet. Record one first.`}
                    </span>
                  ) : undefined
                }
              >
                {/* The guard is on the call rather than the row: a press while a change is in flight does nothing. */}
                <InsetRow title="Change currency" action onClick={() => !busy && void changeCurrency()} className={busy ? 'opacity-40' : undefined} />
              </InsetGroup>
            )}

            <InsetGroup wide>
              <SwitchRow label="Budget" info="Events count in the budget" checked={book.countEventsInBudget} onChange={(checked) => !busy && void setEvents(checked)} />
            </InsetGroup>

            {book.kind === 'business' && !shared && (
              <InsetGroup wide>
                <InsetRow title="Use the Business list" action testId="use-business-list" onClick={() => !busy && setOffering(true)} className={busy ? 'opacity-40' : undefined} />
              </InsetGroup>
            )}

            {/* Household sharing (spec §11): one row, Off or On, into the Share page. */}
            <ShareRow book={book} />

            {/* Its own group: the air between two groups is the only undo a finger gets before an archive. */}
            <InsetGroup wide>
              <DestructiveRow calm label={armed ? 'Click again to archive' : 'Archive'} onClick={() => !busy && (armed ? void archive() : setArmed(true))} />
              <DestructiveRow testId="delete-workspace" label={armedDelete ? 'Click again to delete' : 'Delete'} onClick={() => !busy && void remove()} />
            </InsetGroup>
          </>
        )}
      </div>
      {deleting && <DeleteWorkspaceSheet book={book} plan={deleting} onClose={() => setDeleting(null)} onDeleted={leave} />}
      {offering && <BusinessListAlert onUse={() => void useBusinessList()} onClose={() => setOffering(false)} />}
      {renaming && <NameSheet current={book.name} busy={busy} onSave={rename} onClose={() => setRenaming(false)} />}
      {choosingCurrency && (
        <CurrencySheet
          current={currency}
          onChoose={(code) => {
            setCurrency(code);
            setChoosingCurrency(false);
          }}
          onClose={() => setChoosingCurrency(false)}
        />
      )}
      {choosingType && <TypeSheet current={book.kind} onChoose={changeKind} onClose={() => setChoosingType(false)} />}
    </div>
  );
}
