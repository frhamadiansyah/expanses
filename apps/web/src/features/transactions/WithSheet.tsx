import { formatMinor } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { Check, Smile, X } from 'lucide-react';
import { SearchPill, SegmentedControl } from '../../ui/native';
import { useRecentPeople } from '../debts/queries';
import { billMinor, type FormDraft, peopleOn, type WithRow, withShares } from './tx-form';

/**
 * "None", or "3 people · Owed Rp 300.000" — what the With row says without being opened.
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
  return `${people.length} ${people.length === 1 ? 'person' : 'people'} · Owed ${formatMinor(theirs, currency)}`;
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
  const needle = typed.toLowerCase();
  // Everybody that can be picked: the people on the books, then anybody put on this bill by name alone (not yet on
  // the books — `splitBill` opens them on saving), so a person just added stays in the row to be un-picked.
  const known = recent.map((person) => ({ accountId: person.accountId, name: person.personName }));
  const extras = people
    .filter((row) => !row.debtAccountId && !known.some((k) => k.name.toLowerCase() === row.name.trim().toLowerCase()))
    .map((row) => ({ accountId: '', name: row.name.trim() }));
  const everyone = [...known, ...extras];
  const shown = needle ? everyone.filter((person) => person.name.toLowerCase().includes(needle)) : everyone;
  const rowOf = (person: { accountId: string; name: string }) =>
    people.findIndex((row) => (person.accountId ? row.debtAccountId === person.accountId : !row.debtAccountId && row.name.trim().toLowerCase() === person.name.toLowerCase()));
  // Somebody already in the row, spelled out in full, is that person rather than a second account of the same name.
  const exact = everyone.find((person) => person.name.toLowerCase() === needle);

  function add(row: WithRow) {
    onChange({
      ...draft,
      with: [...people, row],
      // The first person turns the sheet on at Split equally. An empty box per friend, which Save then refuses
      // with "Share 1 amount must be greater than zero", is not a starting point; whatever is chosen after
      // that is left exactly as chosen.
      withEqually: people.length === 0 ? true : draft.withEqually,
    });
  }

  function toggle(person: { accountId: string; name: string }) {
    const at = rowOf(person);
    if (at >= 0) onChange({ ...draft, with: people.filter((_, j) => j !== at) });
    else add({ debtAccountId: person.accountId, name: person.name, amount: '' });
  }

  // Enter, or the dashed circle: the typed name is added and picked. A name already in the row is picked, not made twice.
  const addTyped = () => {
    if (!typed) return;
    setSearch('');
    if (exact) {
      if (rowOf(exact) < 0) add({ debtAccountId: exact.accountId, name: exact.name, amount: '' });
      return;
    }
    add({ debtAccountId: '', name: typed, amount: '' });
  };

  return (
    <Sheet grouped title="With" onClose={onClose}>
      <div className="flex flex-col gap-[10px]">
        <SearchPill value={search} onChange={setSearch} onClose={() => setSearch('')} placeholder="Search or add a person" label="Search or add a person" onEnter={addTyped} enterKeyHint="done" />

        {/* One row, sideways: no wrapping, no scrollbar, a soft fade where it runs on. */}
        <div
          className="-mx-1 flex snap-x gap-[14px] overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(90deg,#000_calc(100%-34px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-testid="with-people"
        >
          {typed && !exact && (
            <button type="button" aria-label={`New person ${typed}`} onClick={addTyped} className="ph-tap w-[62px] shrink-0 snap-start text-center">
              <span className="mx-auto flex h-[54px] w-[54px] items-center justify-center rounded-full border-[1.5px] border-dashed border-[#0a84ff] text-[20px] font-semibold text-[#0a84ff]">
                {typed.charAt(0).toUpperCase()}
              </span>
              <span className="mt-1 block truncate text-[12.5px] leading-4 text-[#0a84ff]">{typed}</span>
            </button>
          )}
          {shown.map((person) => {
            const picked = rowOf(person) >= 0;
            return (
              <button
                key={person.accountId || `name:${person.name}`}
                type="button"
                aria-label={person.name}
                aria-pressed={picked}
                onClick={() => toggle(person)}
                className="ph-tap w-[62px] shrink-0 snap-start text-center"
              >
                <span
                  className={`relative mx-auto flex h-[54px] w-[54px] items-center justify-center rounded-full text-[20px] font-semibold ${picked ? 'bg-[var(--ph-ink)] text-[var(--ph-surface)]' : 'bg-[var(--ph-fill)] text-[var(--ph-ink-2)]'}`}
                >
                  {person.name.trim().charAt(0).toUpperCase() || '?'}
                  {picked && (
                    <span aria-hidden className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--ph-surface)] text-[var(--ph-ink)] ring-[1.5px] ring-[var(--ph-ink)]">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="mt-1 block truncate text-[12.5px] leading-4 text-[var(--ph-ink)]">{person.name}</span>
              </button>
            );
          })}
        </div>

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
                    <span className="block text-[15px] leading-5 text-[var(--ph-ink)]">Me</span>
                    <span className="block text-[12.5px] leading-4 text-[var(--ph-ink-3)]">{['My spending', categoryName].filter(Boolean).join(' · ')}</span>
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
                      <span className="block text-[12.5px] leading-4 text-[var(--ph-ink-3)]">Owes</span>
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
                <span className="font-semibold text-[var(--ph-ink)]">Owed</span>
                <span className="tabular text-[var(--ph-ink-3)]">{formatMinor(theirs, currency)}</span>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-4 px-[13px]">
                <span className="font-semibold text-[var(--ph-ink)]">My share</span>
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
