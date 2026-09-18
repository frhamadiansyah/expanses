import { CURRENCIES, isoDate } from '@expanses/core';
import { archiveBook, type BookRow, findRate, renameBook, setBookBaseCurrency, setBookEventsInBudget } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { usePhone } from '../../app/use-phone';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, ErrorBox, Field, Input, PageHeader, Select } from '../../ui';
import { useBooks } from './queries';
import { WorkspaceDot } from './WorkspaceBadge';

const KIND_LABEL: Record<string, string> = { personal: 'Personal', business: 'Business', family: 'Family', shared: 'Shared' };

/** The row itself: who the workspace is, in the two words and one code that tell it apart from its neighbours. */
function Face({ book }: { book: BookRow }) {
  return (
    <>
      <WorkspaceDot book={book} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{book.name}</span>
        <span className="block text-xs text-slate-500">
          {KIND_LABEL[book.kind] ?? book.kind} · {book.baseCurrency}
        </span>
      </span>
      <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
    </>
  );
}

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
    <div className="space-y-4 px-1 pt-3 pb-1">
      <ErrorBox error={error} />
      {note && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{note}</p>}

      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <Field label="Name">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="pb-1">
          <Button onClick={rename} disabled={busy}>
            Save
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <Field label="Reads in" hint="Its Cashflow, budgets and bills are converted into this.">
          <Select value={currency} onChange={(event) => setCurrency(event.target.value)}>
            {CURRENCIES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.code} — {option.name}
              </option>
            ))}
          </Select>
        </Field>
        {currency !== book.baseCurrency && (
          <div className="pb-1">
            <Button onClick={changeCurrency} disabled={busy}>
              Change currency
            </Button>
          </div>
        )}
      </div>
      {currency !== book.baseCurrency && rate.isSuccess && (
        <p data-testid="currency-note" className={cx('text-xs', rate.data ? 'text-slate-500' : 'text-amber-700')}>
          {rate.data
            ? `Caps and expected income will be converted at ${rate.data.rate} from ${rate.data.onDate}`
            : `No ${book.baseCurrency}→${currency} rate yet. Record one first.`}
        </p>
      )}

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" role="switch" className="mt-0.5" checked={book.countEventsInBudget} disabled={busy} onChange={(event) => void setEvents(event.target.checked)} />
        Count event spending in this workspace&rsquo;s monthly budget
      </label>

      <div className="border-t border-slate-100 pt-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => (armed ? void archive() : setArmed(true))}
          className={cx('rounded-lg px-2 py-1 text-xs font-medium', armed ? 'bg-red-700 text-white' : 'text-red-700 hover:bg-red-50')}
        >
          {armed ? 'Click again to archive' : 'Archive workspace'}
        </button>
      </div>
    </div>
  );
}

/**
 * One workspace on the list, and the way into what it holds.
 *
 * A wide screen opens it where it stands, so the workspace above and below stay in view while it is being
 * changed; a phone has no room for that and lifts it into a sheet instead.
 */
function WorkspaceRow({ book }: { book: BookRow }) {
  const phone = usePhone();
  const [open, setOpen] = useState(false);

  if (phone) {
    return (
      <li data-testid="workspace-entry">
        <button
          type="button"
          data-testid="settings-workspace-row"
          onClick={() => setOpen(true)}
          className="flex min-h-11 w-full items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-slate-50"
        >
          <Face book={book} />
        </button>
        {open && (
          <Sheet title={book.name} onClose={() => setOpen(false)}>
            <WorkspaceSettings book={book} />
          </Sheet>
        )}
      </li>
    );
  }

  return (
    <li data-testid="workspace-entry">
      <details>
        <summary data-testid="settings-workspace-row" className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg px-1 py-2 hover:bg-slate-50">
          <Face book={book} />
        </summary>
        <WorkspaceSettings book={book} />
      </details>
    </li>
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
    <div className="space-y-4">
      <PageHeader title="Settings" />

      <Card className="space-y-1">
        <h2 className="text-sm font-semibold">Your money</h2>
        <p className="text-sm">
          {workspaceName} · <span className="font-medium">{ws.baseCurrency}</span>
        </p>
        <p className="text-xs text-slate-500">Net worth, balances, statements and the tax report are read in this currency.</p>
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-semibold">Workspaces</h2>
        {books.isSuccess && books.data.length === 0 && <p className="py-3 text-sm text-slate-500">{workspaceName} has no workspaces yet.</p>}
        <ul className="divide-y divide-slate-100">
          {(books.data ?? []).map((book) => (
            <WorkspaceRow key={book.id} book={book} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
