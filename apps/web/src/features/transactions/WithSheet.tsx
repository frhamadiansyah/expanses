import { formatMinor } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { Search, Smile, X } from 'lucide-react';
import { SegmentedControl } from '../../ui/native';
import { useRecentPeople } from '../debts/queries';
import { billMinor, type FormDraft, peopleOn, type WithRow, withShares } from './tx-form';

/**
 * "None", or "3 people · They owe you Rp 300.000" — what the With row says without being opened.
 *
 * `formatMinor`, never `minorToMajorString`: the same reason `splitSummary` gives. A display figure carries its
 * currency and its exponent with it, or US$85,00 is written "85.00" and read by this app's own number formatting
 * as eighty-five thousand.
 */
export function withSummary(draft: FormDraft, accounts: readonly AccountRow[], currency: string): string {
  const people = peopleOn(draft);
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
    <Sheet grouped title="With" onClose={onClose}>
      <div className="flex flex-col gap-[10px]">
        {/* D4's search field. Add stays beside it: a name nobody has met yet is added by it, not only by Enter. */}
        <div className="flex items-center gap-2">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-[var(--ph-track)] px-3">
            <Search size={16} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
            <input
              aria-label="Add a person"
              value={search}
              placeholder="Add a person"
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                // Enter means Add here, and nothing else. `Sheet` is not a portal, so this input is not inside
                // the card's `<form>` — but the Add button is `type="button"` for the same reason, and an Enter
                // left to the browser in a box beside it would do nothing at all.
                e.preventDefault();
                addTyped();
              }}
              className="min-w-0 flex-1 bg-transparent text-base text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none md:text-[15px]"
            />
          </label>
          <button
            type="button"
            onClick={addTyped}
            disabled={!typed}
            className="ph-focus min-h-10 shrink-0 rounded-full px-3 text-[15px] font-medium text-[var(--ph-tint)] disabled:opacity-40"
          >
            Add
          </button>
        </div>

        {offered.length > 0 && (
          <div className="flex flex-wrap gap-[6px]">
            {offered.map((person) => (
              <button
                key={person.accountId}
                type="button"
                aria-label={person.personName}
                onClick={() => add({ debtAccountId: person.accountId, name: person.personName, amount: '' })}
                className="ph-focus min-h-9 rounded-full bg-[var(--ph-surface)] px-3 text-[13px] text-[var(--ph-ink)] ring-[0.5px] ring-[var(--ph-hair)] active:bg-[var(--ph-fill)]"
              >
                + {person.personName}
              </button>
            ))}
          </div>
        )}

        {people.length > 0 && (
          <>
            <SegmentedControl
              label="How the bill is divided"
              segments={[
                { key: 'equally', label: 'Split equally' },
                { key: 'custom', label: 'Custom amounts' },
              ]}
              value={draft.withEqually ? 'equally' : 'custom'}
              onChange={(key) => onChange({ ...draft, withEqually: key === 'equally' })}
            />

            <ul className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>li+li>.ph-row-body]:border-t-[0.5px] [&>li+li>.ph-row-body]:border-[var(--ph-hair)]">
              <li className="flex items-center gap-[10px] pl-[12px]">
                <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ph-tint-panel)] text-[var(--ph-tint)]">
                  <Smile size={16} />
                </span>
                <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-3 py-2 pr-[13px]">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-5 text-[var(--ph-ink)]">You</span>
                    <span className="block text-[12.5px] leading-4 text-[var(--ph-ink-3)]">{['Your spending', categoryName].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="tabular shrink-0 text-right text-[15px] text-[var(--ph-ink-3)]" data-testid="with-your-share">
                    {ownShareMinor === null ? '—' : formatMinor(ownShareMinor, currency)}
                  </span>
                </span>
              </li>
              {people.map((row, i) => (
                <li key={i} className="flex items-center gap-[10px] pl-[12px]">
                  <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[13px] font-semibold text-[var(--ph-ink-2)]">
                    {(row.name || '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] leading-5 text-[var(--ph-ink)]">{row.name || 'Someone'}</span>
                      <span className="block text-[12.5px] leading-4 text-[var(--ph-ink-3)]">Owes you</span>
                    </span>
                    {draft.withEqually ? (
                      <span className="tabular shrink-0 text-right text-[15px] text-[var(--ph-ink-3)]">{formatMinor(each[i] ?? 0, currency)}</span>
                    ) : (
                      <input
                        aria-label={`What ${row.name || 'they'} owe`}
                        className="ph-focus-inset tabular w-28 shrink-0 rounded-lg bg-[var(--ph-fill)] px-2 py-1 text-right text-base text-[var(--ph-ink)] md:text-[15px]"
                        value={row.amount}
                        inputMode="decimal"
                        onChange={(e) => onChange({ ...draft, with: people.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)) })}
                      />
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${row.name || `person ${i + 1}`}`}
                      onClick={() => onChange({ ...draft, with: people.filter((_, j) => j !== i) })}
                      className="ph-focus-inset flex h-11 w-11 shrink-0 items-center justify-center text-[var(--ph-ink-3)]"
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </span>
                </li>
              ))}
            </ul>

            <div
              data-testid="with-summary"
              className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] text-[15px] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]"
            >
              <div className="flex min-h-11 items-center justify-between gap-4 px-[13px]">
                <span className="text-[var(--ph-ink)]">Bill</span>
                <span className="tabular text-[var(--ph-ink-3)]">{formatMinor(bill, currency)}</span>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-4 px-[13px]">
                <span className="font-semibold text-[var(--ph-ink)]">They owe you</span>
                <span className="tabular text-[var(--ph-ink-3)]">{formatMinor(theirs, currency)}</span>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-4 px-[13px]">
                <span className="font-semibold text-[var(--ph-ink)]">Your share</span>
                <span className="tabular text-[var(--ph-ink)]">
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
