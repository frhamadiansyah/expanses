import { CURRENCIES } from '@expanses/core';
import { type BookKind, createBook } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { Button, cx, ErrorBox, Field, Input, Select } from '../../ui';
import { useBooks } from './queries';

const KINDS: { value: BookKind; label: string }[] = [
  { value: 'personal', label: 'Personal' },
  { value: 'business', label: 'Business' },
  { value: 'family', label: 'Family' },
  { value: 'shared', label: 'Shared' },
];

/**
 * Making a workspace: a name, what kind it is, what it starts with, and the currency it reads in.
 *
 * Categories are the only thing copied, and only when asked for. A workspace that starts empty is still given the
 * handful the app posts into by itself — loan interest, a realised gain — so its own records stay its own; the
 * rest are added from the picker as they are needed, which is why no kind comes with a list of its own.
 */
export function NewWorkspaceSheet({ onClose }: { onClose: () => void }) {
  const { database, ws, switchBook } = useApp();
  const books = useBooks();
  const hasPersonal = (books.data ?? []).some((book) => book.kind === 'personal');
  const [name, setName] = useState('');
  // Null until a tile is pressed, so the default settles when the list of workspaces arrives rather than being
  // fixed on the first render — a sheet opened before it loads would otherwise start on a disabled Personal.
  const [chosenKind, setChosenKind] = useState<BookKind | null>(null);
  const kind = chosenKind ?? (hasPersonal ? 'business' : 'personal');
  const [copyFrom, setCopyFrom] = useState('');
  const [baseCurrency, setBaseCurrency] = useState(ws.baseCurrency);
  // Null while nobody has touched the switch: a business counts an event as spending like any other, where a
  // personal budget is usually kept for the ordinary month with the holiday counted apart.
  const [events, setEvents] = useState<boolean | null>(null);
  const countEventsInBudget = events ?? kind === 'business';
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = await createBook(database, ws, { name, kind, baseCurrency, countEventsInBudget, copyCategoriesFrom: copyFrom || null });
      // Made to be used: the app lands in it rather than leaving it to be found in the list.
      await switchBook(id);
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="New workspace" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {/* The repository's words are the product's words: a refusal is shown as it comes. */}
        <ErrorBox error={error} />
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Business" required autoFocus />
        </Field>

        <fieldset>
          <legend className="mb-1 block text-xs font-medium text-slate-600">Kind</legend>
          <div className="grid grid-cols-4 gap-2">
            {KINDS.map((option) => {
              // There is only ever one Personal: it is where categories and expected income fall back to.
              const disabled = option.value === 'personal' && hasPersonal;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  title={disabled ? 'There is already a Personal workspace' : undefined}
                  aria-pressed={kind === option.value}
                  onClick={() => setChosenKind(option.value)}
                  className={cx(
                    'min-h-11 rounded-lg px-2 py-2 text-sm font-medium ring-1 disabled:opacity-40',
                    kind === option.value ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts with" hint="A copy is its own tree: renaming one afterwards leaves the other alone.">
            <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">Start empty</option>
              {(books.data ?? []).map((book) => (
                <option key={book.id} value={book.id}>
                  Copy from {book.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reads in" hint="Its Cashflow, budgets and bills are converted into this.">
            <Select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>
              {CURRENCIES.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} — {currency.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <fieldset>
          <legend className="mb-1 block text-xs font-medium text-slate-600">Events</legend>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              role="switch"
              className="mt-0.5"
              checked={countEventsInBudget}
              onChange={(e) => setEvents(e.target.checked)}
            />
            Count event spending in this workspace&rsquo;s monthly budget
          </label>
        </fieldset>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Create workspace
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
