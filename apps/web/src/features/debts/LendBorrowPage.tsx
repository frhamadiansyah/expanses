import type { PersonDebtRow } from '@expanses/db';
import { ChevronLeft, HelpCircle, Plus } from 'lucide-react';
import { Link, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { Empty, ErrorBox, Money } from '../../ui';
import { useHeldRates } from '../accounts/queries';
import { type CornerAction, Figure, InsetGroup, InsetRow, LargeTitle, PanelHeader, SCREEN, type Segment, SegmentedControl } from '../../ui/native';
import { DebtForm } from './DebtForm';
import { PersonCard } from './PersonCard';
import { usePeopleDebts } from './queries';
import { sideTotal } from './totals';

/**
 * One side of the ledger.
 *
 * "Receivables" and "Payables" were headings *inside* cards; they are group headers now, outside and above what
 * they name, with the side's total beside them. That is the one thing the audit asks of this screen.
 */
function Column({ title, people, emptyText, currency, rates }: { title: string; people: PersonDebtRow[]; emptyText: string; currency: string; rates: Record<string, number> | undefined }) {
  const total = sideTotal(people, currency, rates ?? {});
  // Until the held rates are read, a foreign card has no figure yet; saying "no rate" then would be untrue.
  const figure =
    total.totalMinor !== null ? (
      <Money minor={total.totalMinor} currency={currency} />
    ) : rates === undefined ? null : (
      <Figure tone="warn">{`No ${total.missing.join(', ')} rate yet`}</Figure>
    );
  return (
    <div>
      <PanelHeader title={title} trailing={<span data-testid={`debts-total-${title}`}>{figure}</span>} />
      {people.length === 0 && <p className="px-[4px] pb-[18px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">{emptyText}</p>}
      {people.map((person) => (
        <PersonCard key={`${person.direction}-${person.personName}-${person.currency}`} person={person} />
      ))}
    </div>
  );
}

/** The phone draws one side at a time. The ledger's own names for the two sides, as the report files them. */
const SIDES: readonly Segment[] = [
  { key: 'owed', label: 'Receivables' },
  { key: 'owe', label: 'Payables' },
];
type Side = 'owed' | 'owe';

export function LendBorrowPage() {
  const { ws } = useApp();
  const phone = usePhone();
  const people = usePeopleDebts();
  // Opened from a person's row on Debts: that person alone, with the way back to everyone one tap away.
  const { person: only } = useSearch({ from: '/net-worth/lend-borrow' });
  const theirs = (list: PersonDebtRow[]) => (only ? list.filter((row) => row.personName === only) : list);
  const [adding, setAdding] = useState(false);
  const [showSettled, setShowSettled] = useState(false);
  // Which side the phone is showing. Null until the reader picks one, so the first paint shows something.
  const [side, setSide] = useState<Side | null>(null);

  const owedToYou = theirs(people.data?.owedToYou ?? []);
  const youOwe = theirs(people.data?.youOwe ?? []);
  const settled = theirs(people.data?.settled ?? []);
  const held = useHeldRates([...owedToYou, ...youOwe].map((person) => person.currency));
  const rates = held.data?.rates;
  const nothingYet = people.isSuccess && owedToYou.length === 0 && youOwe.length === 0 && settled.length === 0;
  /*
   * Which side the phone opens on. The first segment — Receivables — unless a person was named (the
   * way in from their row on Debts), where it is the side that person is on: opening Dewi's row must show Dewi,
   * not an empty list. Never derived from how many rows each side has, so a reader who forgives their last
   * borrower does not have the list switch sides under them.
   */
  const shown: Side = side ?? (only && owedToYou.length === 0 ? 'owe' : 'owed');

  // While the inline form is open there is no action to show, and an empty corner would still take its gap.
  const actions: CornerAction[] = adding
    ? []
    : [
        { key: 'add', label: 'Add a loan', glyph: <Plus size={20} aria-hidden />, run: () => setAdding(true) },
        // The inline form is still one tap away; the picker is for when you do not know what to call it.
        { key: 'pick', label: 'What do you owe?', glyph: <HelpCircle size={20} aria-hidden />, to: '/debts/new' },
      ];

  return (
    <div className={SCREEN}>
      <LargeTitle title="Lend & borrow" actions={actions} />
      {/*
       * No section strip: this page left Net worth for Cashflow, because money between you and people is money
       * moving. The way back is the list it moves with, and one honest line says more than a strip with nothing lit.
       */}
      <Link to="/transactions" className="-mt-1 mb-[18px] flex min-h-11 items-center gap-1 text-sm font-medium text-emerald-800">
        <ChevronLeft size={16} aria-hidden />
        Cashflow
      </Link>
      <ErrorBox error={people.error} />

      {adding && <DebtForm onDone={() => setAdding(false)} />}

      {only && (
        <InsetGroup header={`Only ${only}`}>
          <InsetRow title="Show everyone" to="/net-worth/lend-borrow" search={{}} />
        </InsetGroup>
      )}

      {nothingYet && !adding && (
        <Empty>
          Nothing lent or borrowed yet. Money you lend leaves your cash and waits under Receivables; money you borrow shows as a debt until you pay it back.
        </Empty>
      )}

      {!nothingYet &&
        (phone ? (
          <>
            {/* The phone shows one list at a time, as the mockup draws it; the desktop keeps both side by side. */}
            <SegmentedControl segments={SIDES} value={shown} onChange={(key) => setSide(key as Side)} label="Lend & borrow" className="mb-[18px]" />
            {shown === 'owed' ? (
              <Column title="Receivables" people={owedToYou} emptyText="Nobody owes you anything." currency={ws.baseCurrency} rates={rates} />
            ) : (
              <Column title="Payables" people={youOwe} emptyText="You owe nobody." currency={ws.baseCurrency} rates={rates} />
            )}
          </>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <Column title="Receivables" people={owedToYou} emptyText="Nobody owes you anything." currency={ws.baseCurrency} rates={rates} />
            <Column title="Payables" people={youOwe} emptyText="You owe nobody." currency={ws.baseCurrency} rates={rates} />
          </div>
        ))}

      {settled.length > 0 && (
        <>
          <InsetGroup>
            <InsetRow title={`${showSettled ? 'Hide' : 'Show'} settled (${settled.length})`} chevron={false} onClick={() => setShowSettled((open) => !open)} />
          </InsetGroup>
          {showSettled && (
            <div className="grid gap-x-6 md:grid-cols-2">
              {settled.map((person) => (
                <PersonCard key={`settled-${person.direction}-${person.personName}-${person.currency}`} person={person} />
              ))}
            </div>
          )}
        </>
      )}

      <p className="px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
        Lending is not spending: the money moves from your account to the person, and comes back the same way. Only interest counts as income or as a cost.
      </p>
    </div>
  );
}
