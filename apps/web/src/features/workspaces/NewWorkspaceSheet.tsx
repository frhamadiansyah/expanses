import { applyCategoryStart, type BookKind, type CategoryStart, createBook } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { cx, ErrorBox } from '../../ui';
import { InsetGroup, PickerRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { CurrencySheet } from '../currency/CurrencySheet';
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
 * rest are added from the picker as they are needed. Only Business offers a list of its own (`BUSINESS_CATEGORIES`),
 * chosen in Categories and applied right after the workspace is made.
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
  // A Business workspace chooses its categories here instead of copying a tree: its own list, Personal's, or none.
  const [chosenStart, setChosenStart] = useState<CategoryStart>('business');
  const categoriesChoice = kind === 'business' && copyFrom === '';
  const personalBookId = (books.data ?? []).find((book) => book.kind === 'personal')?.id ?? null;
  const [baseCurrency, setBaseCurrency] = useState(ws.baseCurrency);
  const [pickingCurrency, setPickingCurrency] = useState(false);
  // Null while nobody has touched the switch: a business counts an event as spending like any other, where a
  // personal budget is usually kept for the ordinary month with the holiday counted apart.
  const [events, setEvents] = useState<boolean | null>(null);
  const countEventsInBudget = events ?? kind === 'business';
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // 'Same as Personal' is a copy of Personal's tree; with no Personal to copy it starts empty, like Empty.
      const copy = categoriesChoice ? (chosenStart === 'personal' ? personalBookId : null) : copyFrom || null;
      const id = await createBook(database, ws, { name, kind, baseCurrency, countEventsInBudget, copyCategoriesFrom: copy });
      // The workspace exists now; if the list cannot be added it can be, from its page, later.
      if (categoriesChoice && chosenStart === 'business') await applyCategoryStart(database, ws, { bookId: id, start: 'business' }).catch(() => undefined);
      // Made to be used: the app lands in it rather than leaving it to be found in the list.
      await switchBook(id);
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  // ✓ in the header saves, as every grouped sheet does; Enter in the name saves too.
  const canSave = name.trim() !== '' && !busy;
  return (
    <>
    <Sheet grouped title="New workspace" onClose={onClose} confirm={{ label: 'Create workspace', disabled: !canSave, run: () => void submit() }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) void submit();
        }}
      >
        {/* The repository's words are the product's words: a refusal is shown as it comes. */}
        <ErrorBox error={error} />
        <InsetGroup>
          <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Required" required autoFocus />
        </InsetGroup>

        <InsetGroup header="Kind">
          <div className="grid grid-cols-4 gap-1.5 p-1.5" role="group" aria-label="Kind">
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
                    'ph-focus min-h-9 rounded-[8px] px-1 text-[13px] font-semibold disabled:opacity-35',
                    kind === option.value ? 'bg-[var(--ph-ink)] text-[var(--ph-surface)]' : 'bg-[var(--ph-fill)] text-[var(--ph-ink-2)]',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </InsetGroup>

        <InsetGroup footer="A copy is its own tree: renaming one afterwards leaves the other alone. Cashflow, budgets and bills read in its currency.">
          <SelectRow label="Starts with" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">Start empty</option>
            {(books.data ?? []).map((book) => (
              <option key={book.id} value={book.id}>
                Copy from {book.name}
              </option>
            ))}
          </SelectRow>
          {/* Only for a Business workspace that is not copying a tree: a copy already is its categories. */}
          {categoriesChoice && (
            <SelectRow label="Categories" value={chosenStart} onChange={(e) => setChosenStart(e.target.value as CategoryStart)}>
              <option value="business">Business</option>
              <option value="personal">Same as Personal</option>
              <option value="empty">Empty</option>
            </SelectRow>
          )}
          <PickerRow label="Reads in" value={baseCurrency} onOpen={() => setPickingCurrency(true)} />
        </InsetGroup>

        <InsetGroup>
          <SwitchRow label="Count event spending in its monthly budget" checked={countEventsInBudget} onChange={setEvents} />
        </InsetGroup>
      </form>
    </Sheet>
      {pickingCurrency && <CurrencySheet value={baseCurrency} baseCurrency={ws.baseCurrency} onPick={setBaseCurrency} onClose={() => setPickingCurrency(false)} />}
    </>
  );
}
