import { CURRENCIES, isoDate } from '@expanses/core';
import { archiveBook, type BookRow, findRate, renameBook, restoreBook, setBookBaseCurrency, setBookEventsInBudget } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { usePhone } from '../../app/use-phone';
import { isNative } from '../../lib/pwa';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { type CornerAction, DestructiveRow, type GroupChild, InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { useSharedBooks } from '../sharing/queries';
import { SharingSection } from '../sharing/SharingSection';
import { useArchivedBooks, useBooks } from './queries';
import { WorkspaceDot } from './WorkspaceBadge';

const KIND_LABEL: Record<string, string> = { personal: 'Personal', business: 'Business', family: 'Family', shared: 'Shared' };

/**
 * The ✓ that saves a workspace's name. The settings do not draw a title bar of their own — a phone's sheet and a
 * wide screen's Settings title own it — so they hand this up and whichever bar is over them draws it.
 */
interface SaveName {
  disabled: boolean;
  run: () => void;
}

/**
 * Everything one workspace can be told to do: what it is called, what it reads in, whether an event counts
 * against its caps, and the way to put it away.
 *
 * Changing a currency is agreed to with the rate in front of you, because it rewrites every cap the workspace
 * holds; archiving asks twice, as deleting a row does, since the first press of a destructive button is as
 * often a mis-tap as it is a decision.
 *
 * The name is saved by the ✓ in the title bar (or Enter in the field), the way every other form in the app is
 * saved: a row titled "Save" under the field read as one more setting rather than as the thing that saves.
 */
function WorkspaceSettings({ book, onSaveName, onArchived }: { book: BookRow; onSaveName: (save: SaveName | null) => void; onArchived: () => void }) {
  const { database, ws, switchBook } = useApp();
  const books = useBooks();
  const invalidate = useInvalidateAll();
  const [name, setName] = useState(book.name);
  const [currency, setCurrency] = useState(book.baseCurrency);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  // A shared workspace keeps the currency it was shared in (sharing spec §6.5 step 0; final review, minor 3): the row is
  // not offered, and the repository refuses it anyway.
  const shared = (useSharedBooks().data ?? []).some((each) => each.bookId === book.id);

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

  const rename = () =>
    run(async () => {
      await renameBook(database, ws, book.id, name);
      return `Now called ${name.trim()}.`;
    });
  // Dim until there is something to save: a name left as it was, or cleared, has nothing for the ✓ to do.
  const renamable = !busy && name.trim() !== '' && name.trim() !== book.name;

  // Handed up only when whether it can save changes; the ref keeps the press reading the name as typed now, so the
  // bar is not told again on every keystroke.
  const renameNow = useRef(rename);
  renameNow.current = rename;
  useEffect(() => {
    onSaveName({ disabled: !renamable, run: () => void renameNow.current() });
  }, [renamable, onSaveName]);
  useEffect(() => () => onSaveName(null), [onSaveName]);

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
      onArchived();
      // The app cannot stay in a workspace that has just been put away: it falls back to Personal, as every
      // other fallback in the app does.
      if (book.id === ws.bookId) {
        const rest = (books.data ?? []).filter((other) => other.id !== book.id);
        const next = rest.find((other) => other.kind === 'personal') ?? rest[0];
        if (next) await switchBook(next.id);
      }
      return null;
    });

  return (
    <div className="pt-[10px]">
      <ErrorBox error={error} />
      {note && <p className="pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-tint)]">{note}</p>}

      <InsetGroup wide>
        <TextRow
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (renamable) void rename();
          }}
          enterKeyHint="done"
        />
      </InsetGroup>

      {shared ? (
        <InsetGroup wide footer="A shared workspace keeps the currency it was shared in.">
          <ReadOnlyRow label="Reads in" value={book.baseCurrency} />
        </InsetGroup>
      ) : (
      <InsetGroup
        wide
        footer={
          currency !== book.baseCurrency && rate.isSuccess ? (
            <span data-testid="currency-note" className={rate.data ? undefined : 'text-[var(--ph-warn)]'}>
              {rate.data
                ? `Caps and expected income will be converted at ${rate.data.rate} from ${rate.data.onDate}`
                : `No ${book.baseCurrency}→${currency} rate yet. Record one first.`}
            </span>
          ) : (
            'Its Cashflow, budgets and bills are converted into this.'
          )
        }
      >
        <SelectRow label="Reads in" value={currency} onChange={(event) => setCurrency(event.target.value)}>
          {CURRENCIES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.code} — {option.name}
            </option>
          ))}
        </SelectRow>
        {/* The guard is on the call rather than the row: a press while a change is in flight does nothing, exactly as a
            disabled button did nothing. */}
        {currency !== book.baseCurrency ? (
          <InsetRow title="Change currency" chevron={false} onClick={() => !busy && changeCurrency()} className={busy ? 'opacity-40' : undefined} />
        ) : null}
      </InsetGroup>
      )}

      <InsetGroup wide>
        <SwitchRow
          label="Count event spending in this workspace’s monthly budget"
          checked={book.countEventsInBudget}
          onChange={(checked) => !busy && void setEvents(checked)}
        />
      </InsetGroup>

      {/* Household sharing (spec §11): Share this workspace, or, once shared, its status, members and devices. */}
      <SharingSection book={book} />

      {/* Its own group: the air between two groups is the only undo a finger gets before an archive. */}
      <InsetGroup wide>
        <DestructiveRow label={armed ? 'Click again to archive' : 'Archive workspace'} onClick={() => !busy && (armed ? void archive() : setArmed(true))} />
      </InsetGroup>
    </div>
  );
}

/**
 * One workspace on the list, and the way into what it holds.
 *
 * A wide screen opens it where it stands, so the workspace above and below stay in view while it is being
 * changed; a phone has no room for that and lifts it into a sheet instead.
 */
function WorkspaceRow({
  book,
  position,
  open,
  onToggle,
  onClose,
  saveName,
  onSaveName,
}: GroupChild & {
  book: BookRow;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  saveName: SaveName | null;
  onSaveName: (save: SaveName | null) => void;
}) {
  const phone = usePhone();
  const settings = <WorkspaceSettings book={book} onSaveName={onSaveName} onArchived={onClose} />;

  /* One row, both ways: the kit's own, so the dot, the name, the kind and the chevron are not drawn twice. */
  const face = (
    <InsetRow
      position={position}
      testId="settings-workspace-row"
      icon={<WorkspaceDot book={book} />}
      title={book.name}
      subtitle={`${KIND_LABEL[book.kind] ?? book.kind} · ${book.baseCurrency}`}
      chevron
      onClick={onToggle}
    />
  );

  return (
    <div data-testid="workspace-entry">
      {face}
      {/* A wide screen opens it where it stands, so the neighbours stay in view; a phone lifts it into a sheet. */}
      {open &&
        (phone ? (
          /* The sheet's own ✕ · name · ✓ bar, as every sheet that saves has. Given from the first frame, dim until the
             settings say otherwise, so the header does not change shape a moment after it opens. */
          <Sheet
            title={book.name}
            onClose={onClose}
            confirm={{ label: 'Save name', disabled: saveName?.disabled ?? true, run: () => saveName?.run() }}
          >
            {settings}
          </Sheet>
        ) : (
          /* On the ground, not on the group's own white: the groups inside it need something to sit on. */
          <div className="bg-[var(--ph-ground)] px-[13px] pt-[10px]">{settings}</div>
        ))}
    </div>
  );
}

/**
 * Settings: the money you count in, and the workspaces you count it in.
 *
 * Your own base currency is shown rather than offered, because every owner-level figure — net worth, a
 * statement, the tax report — is already recorded against it; a workspace's currency is only a way of reading,
 * so it can be changed here.
 */
export function SettingsPage() {
  const { ws, workspaceName } = useApp();
  const books = useBooks();
  const phone = usePhone();
  // One workspace open at a time, so the ✓ in the title bar can only ever mean one name.
  const [openId, setOpenId] = useState<string | null>(null);
  const [saveName, setSaveName] = useState<SaveName | null>(null);
  // A phone's sheet carries its own ✓; a wide screen opens the workspace in place, under this title, so it is here.
  const actions: CornerAction[] =
    !phone && saveName ? [{ key: 'save', label: 'Save name', glyph: <Check size={20} aria-hidden />, disabled: saveName.disabled, run: saveName.run }] : [];

  return (
    <div className={SCREEN}>
      <LargeTitle title="Settings" actions={actions} />

      {/* The section title moves outside the card it used to sit inside — the kit's one unmissable difference. */}
      <InsetGroup header="Money" footer="Net worth, balances, statements and the tax report are read in this currency.">
        <ReadOnlyRow label={workspaceName} value={ws.baseCurrency} />
      </InsetGroup>

      {isNative() && (
        <InsetGroup
          header="Capture"
          footer="Read payment notifications, screenshots and receipts into the To-review inbox — on this phone only."
        >
          <InsetRow title="Set up capture" to="/settings/capture" />
        </InsetGroup>
      )}

      <InsetGroup header="Workspaces">
        {books.isSuccess && books.data.length === 0 ? (
          [<InsetRow key="none" title={`${workspaceName} has no workspaces yet.`} chevron={false} />]
        ) : (
          (books.data ?? []).map((book) => (
            <WorkspaceRow
              key={book.id}
              book={book}
              open={openId === book.id}
              onToggle={() => setOpenId((was) => (phone || was !== book.id ? book.id : null))}
              onClose={() => setOpenId(null)}
              saveName={saveName}
              onSaveName={setSaveName}
            />
          ))
        )}
      </InsetGroup>

      <ArchivedWorkspaces />
    </div>
  );
}

/**
 * The workspaces that were archived, and the way to bring each one back.
 *
 * Archiving takes a workspace out of every list in the app, so this is the one place it can still be found; shown
 * only while there is one to show. Restoring is not destructive, so it is one press, not two.
 */
function ArchivedWorkspaces() {
  const { database, ws } = useApp();
  const archived = useArchivedBooks();
  const invalidate = useInvalidateAll();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function restore(book: BookRow) {
    setBusy(true);
    setError(null);
    try {
      await restoreBook(database, ws, book.id);
      // The switcher, Cashflow and every picker read the open workspaces: all of them gain one back.
      await invalidate();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (!archived.data?.length) return null;
  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup header="Archived" footer="A restored workspace comes back with everything it held.">
        {archived.data.map((book) => (
          <InsetRow
            key={book.id}
            testId="archived-workspace"
            icon={<WorkspaceDot book={book} />}
            title={book.name}
            subtitle={`${KIND_LABEL[book.kind] ?? book.kind} · ${book.baseCurrency}`}
            value="Restore"
            valueTone="tint"
            chevron={false}
            label={`Restore ${book.name}`}
            disabled={busy}
            onClick={() => void restore(book)}
          />
        ))}
      </InsetGroup>
    </>
  );
}
