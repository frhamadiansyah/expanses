import { formatMinor } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { Button, Input } from '../../ui';
import { useRecentPeople } from '../debts/queries';
import { billMinor, type FormDraft, type WithRow, withShares } from './tx-form';

/** A row names somebody once it carries an account or a typed name; an empty row is not yet a person. */
const named = (rows: readonly WithRow[]) => rows.filter((row) => row.debtAccountId || row.name.trim());

/**
 * "None", or "3 people · They owe you Rp 300.000" — what the With row says without being opened.
 *
 * `formatMinor`, never `minorToMajorString`: the same reason `splitSummary` gives. A display figure carries its
 * currency and its exponent with it, or US$85,00 is written "85.00" and read by this app's own number formatting
 * as eighty-five thousand.
 */
export function withSummary(draft: FormDraft, accounts: readonly AccountRow[], currency: string): string {
  const people = named(draft.with);
  if (people.length === 0) return 'None';
  const { each } = withShares(draft, currency, billMinor(draft, accounts) ?? 0, { lenient: true });
  const theirs = each.reduce((sum, share) => sum + share, 0);
  return `${people.length} ${people.length === 1 ? 'person' : 'people'} · They owe you ${formatMinor(theirs, currency)}`;
}

/**
 * Who else was on this bill — §4's With row, as its own screen.
 *
 * Task 5 put several people into the data (`splitBill` takes a list of shares, `recentPeople` offers the ones
 * already on the books) and the form never caught up: until now the card asked for exactly one name and one
 * figure, so a dinner for four could not be recorded at all. This screen is the catching up, and it adds no
 * arithmetic of its own — `withShares` is the same function `formToPost` divides the bill with, so what the
 * summary card promises is what the save posts, to the rupiah.
 *
 * A name that is not on the books is not opened here. It is carried as a plain name and `splitBill` opens the
 * person on saving, exactly as the single-person card did, so abandoning this form leaves nobody behind.
 */
export function WithSheet({
  draft,
  onChange,
  accounts,
  currency,
  onClose,
}: {
  draft: FormDraft;
  onChange: (draft: FormDraft) => void;
  accounts: readonly AccountRow[];
  currency: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const recent = useRecentPeople().data ?? [];
  const people = draft.with;
  const bill = billMinor(draft, accounts) ?? 0;
  const { each, ownShareMinor } = withShares(draft, currency, bill, { lenient: true });
  const theirs = each.reduce((sum, share) => sum + share, 0);
  const categoryName = accounts.find((account) => account.id === draft.categoryId)?.name ?? '';

  const typed = search.trim();
  const taken = new Set(people.map((row) => row.debtAccountId).filter(Boolean));
  const offered = recent.filter((person) => !taken.has(person.accountId) && person.personName.toLowerCase().includes(typed.toLowerCase()));
  // Somebody already on the books, spelled out in full, is that person rather than a second account of the
  // same name — which is what typing "Andi" and pressing Add would otherwise make.
  const onTheBooks = recent.find((person) => person.personName.toLowerCase() === typed.toLowerCase());

  function add(row: WithRow) {
    onChange({
      ...draft,
      with: [...people, row],
      // The first person turns the sheet on at Split equally. An empty box per friend, which Save then refuses
      // with "Share 1 amount must be greater than zero", is not a starting point; whatever is chosen after
      // that is left exactly as chosen.
      withEqually: people.length === 0 ? true : draft.withEqually,
    });
    setSearch('');
  }

  const addTyped = () => {
    if (!typed) return;
    add(onTheBooks ? { debtAccountId: onTheBooks.accountId, name: onTheBooks.personName, amount: '' } : { debtAccountId: '', name: typed, amount: '' });
  };

  return (
    <Sheet title="With" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input
            aria-label="Add a person"
            value={search}
            placeholder="Andi"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              // A sheet inside a form: Enter here would otherwise submit the transaction behind it.
              e.preventDefault();
              addTyped();
            }}
          />
          <Button variant="secondary" onClick={addTyped} disabled={!typed}>
            Add
          </Button>
        </div>

        {offered.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {offered.map((person) => (
              <button
                key={person.accountId}
                type="button"
                aria-label={person.personName}
                onClick={() => add({ debtAccountId: person.accountId, name: person.personName, amount: '' })}
                className="min-h-11 rounded-full bg-slate-100 px-3 text-sm text-slate-700 hover:bg-slate-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900"
              >
                {person.personName}
              </button>
            ))}
          </div>
        )}

        {people.length > 0 && (
          <>
            <div role="radiogroup" aria-label="How the bill is divided" className="flex flex-wrap gap-2">
              {([
                [true, 'Split equally'],
                [false, 'Custom amounts'],
              ] as const).map(([equally, label]) => (
                <Button
                  key={label}
                  role="radio"
                  aria-checked={draft.withEqually === equally}
                  variant={draft.withEqually === equally ? 'primary' : 'secondary'}
                  onClick={() => onChange({ ...draft, withEqually: equally })}
                >
                  {label}
                </Button>
              ))}
            </div>

            <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
              <li className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block">You</span>
                  <span className="block text-xs text-slate-500">{['Your spending', categoryName].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="tabular shrink-0 text-right" data-testid="with-your-share">
                  {ownShareMinor === null ? '—' : formatMinor(ownShareMinor, currency)}
                </span>
              </li>
              {people.map((row, i) => (
                <li key={i} className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{row.name || 'Someone'}</span>
                    <span className="block text-xs text-slate-500">Owes you</span>
                  </span>
                  {draft.withEqually ? (
                    <span className="tabular shrink-0 text-right">{formatMinor(each[i] ?? 0, currency)}</span>
                  ) : (
                    <Input
                      aria-label={`What ${row.name || 'they'} owe`}
                      className="w-28 shrink-0"
                      value={row.amount}
                      inputMode="decimal"
                      onChange={(e) => onChange({ ...draft, with: people.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)) })}
                    />
                  )}
                  <Button
                    variant="ghost"
                    aria-label={`Remove ${row.name || `person ${i + 1}`}`}
                    onClick={() => onChange({ ...draft, with: people.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </Button>
                </li>
              ))}
            </ul>

            <div data-testid="with-summary" className="space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Bill</span>
                <span className="tabular">{formatMinor(bill, currency)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">They owe you</span>
                <span className="tabular">{formatMinor(theirs, currency)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Your share</span>
                <span className="tabular font-medium">
                  {ownShareMinor === null ? 'More than the bill' : formatMinor(ownShareMinor, currency)}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
