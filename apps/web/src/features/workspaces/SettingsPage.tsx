import { CURRENCIES, isoDate } from '@expanses/core';
import { archiveBook, type BookRow, findRate, renameBook, setBookBaseCurrency, setBookEventsInBudget } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';

import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { usePhone } from '../../app/use-phone';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { DestructiveRow, type GroupChild, InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { useBooks } from './queries';
import { WorkspaceDot } from './WorkspaceBadge';

const KIND_LABEL: Record<string, string> = { personal: 'Personal', business: 'Business', family: 'Family', shared: 'Shared' };


/**
 * Everything one workspace can be told to do: what it is called, what it reads in, whether an event counts
 * against its caps, and the way to put it away.
 *
 * Changing a currency is agreed to with the rate in front of you, because it rewrites every cap the workspace
 * holds; archiving asks twice, as deleting a row does, since the first press of a destructive button is as
 * often a mis-tap as it is a decision.
 */
function WorkspaceSettings({ book }: { book: BookRow }) {
  const { database, ws, switchBook } = useApp();
  const books = useBooks();
  const invalidate = useInvalidateAll();
  const [name, setName] = useState(book.name);
  const [currency, setCurrency] = useState(book.baseCurrency);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);

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
      return null;
    });

  return (
    <div className="pt-[10px]">
      <ErrorBox error={error} />
      {note && <p className="pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-tint)]">{note}</p>}

      <InsetGroup wide>
        <TextRow label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        {/* The kit's rows take no `disabled`, so the guard that was on the button is on the call instead: a
            press while one of these is in flight does nothing, exactly as a disabled button did nothing. */}
        <InsetRow title="Save" chevron={false} onClick={() => !busy && rename()} className={busy ? 'opacity-40' : undefined} />
      </InsetGroup>

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
        {currency !== book.baseCurrency ? (
          <InsetRow title="Change currency" chevron={false} onClick={() => !busy && changeCurrency()} className={busy ? 'opacity-40' : undefined} />
        ) : null}
      </InsetGroup>

      <InsetGroup wide>
        <SwitchRow
          label="Count event spending in this workspace’s monthly budget"
          checked={book.countEventsInBudget}
          onChange={(checked) => !busy && void setEvents(checked)}
        />
      </InsetGroup>

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
function WorkspaceRow({ book, position }: GroupChild & { book: BookRow }) {
  const phone = usePhone();
  const [open, setOpen] = useState(false);

  /* One row, both ways: the kit's own, so the dot, the name, the kind and the chevron are not drawn twice. */
  const face = (
    <InsetRow
      position={position}
      testId="settings-workspace-row"
      icon={<WorkspaceDot book={book} />}
      title={book.name}
      subtitle={`${KIND_LABEL[book.kind] ?? book.kind} · ${book.baseCurrency}`}
      chevron
      onClick={() => setOpen((was) => (phone ? true : !was))}
    />
  );

  return (
    <div data-testid="workspace-entry">
      {face}
      {/* A wide screen opens it where it stands, so the neighbours stay in view; a phone lifts it into a sheet. */}
      {open &&
        (phone ? (
          <Sheet title={book.name} onClose={() => setOpen(false)}>
            <WorkspaceSettings book={book} />
          </Sheet>
        ) : (
          /* On the ground, not on the group's own white: the groups inside it need something to sit on. */
          <div className="bg-[var(--ph-ground)] px-[13px] pt-[10px]">
            <WorkspaceSettings book={book} />
          </div>
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

  return (
    <div className={SCREEN}>
      <LargeTitle title="Settings" />

      {/* The section title moves outside the card it used to sit inside — the kit's one unmissable difference. */}
      <InsetGroup header="Your money" footer="Net worth, balances, statements and the tax report are read in this currency.">
        <ReadOnlyRow label={workspaceName} value={ws.baseCurrency} />
      </InsetGroup>

      <InsetGroup header="Workspaces">
        {books.isSuccess && books.data.length === 0 ? (
          [<InsetRow key="none" title={`${workspaceName} has no workspaces yet.`} chevron={false} />]
        ) : (
          (books.data ?? []).map((book) => <WorkspaceRow key={book.id} book={book} />)
        )}
      </InsetGroup>
    </div>
  );
}
