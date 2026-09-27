import type { PersonDebtRow } from '@expanses/db';
import { Plus } from 'lucide-react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { isoDate } from '@expanses/core';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { Empty, ErrorBox, Money } from '../../ui';
import { useHeldRates } from '../accounts/queries';
import { type CornerAction, Figure, InsetGroup, InsetRow, PanelHeader, PushedTitle, SCREEN, type Segment, SegmentedControl } from '../../ui/native';
import { personDue, personParams } from './lend-borrow-view';
import { usePeopleDebts } from './queries';
import { newDebtPath, openingSide, type Side } from './sides';
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
      {people.length > 0 && <PeopleRows people={people} />}
    </div>
  );
}

/** The pill beside a due date, in the kit's own inks: overdue in alarm, soon in warning, later quiet. */
const DUE_TONE = { late: 'text-[var(--ph-alarm)]', soon: 'text-[var(--ph-warn)]', later: 'text-[var(--ph-ink-3)]' } as const;

/**
 * One row per person: their initial, their name, their one loan's reason or how many loans, the most urgent due date,
 * and what they owe in all. Nothing to press but the row itself — repaying, forgiving and changing a loan are on the
 * loan's own page, one tap further in, where they used to be buttons and a picker under every loan.
 */
function PeopleRows({ people }: { people: PersonDebtRow[] }) {
  const today = isoDate();
  return (
    <InsetGroup>
      {people.map((person) => {
        const due = personDue(person, today);
        return (
          <InsetRow
            key={`${person.direction}-${person.personName}-${person.currency}`}
            icon={<span className="text-[14px] leading-none font-semibold">{person.personName.trim().charAt(0).toUpperCase()}</span>}
            iconColour="var(--ph-tint)"
            title={person.personName}
            // Only a due date earns a second line: the name and the figure say the rest, and the loans are told
            // apart on the person's own page.
            subtitle={due ? <span className={`font-medium ${DUE_TONE[due.tone]}`}>{due.label}</span> : undefined}
            value={<Money minor={person.totalMinor} currency={person.currency} />}
            valueTone="ink"
            to="/net-worth/lend-borrow/$side/$person"
            params={personParams(person)}
            testId="person-row"
          />
        );
      })}
    </InsetGroup>
  );
}

/** The phone draws one side at a time. The ledger's own names for the two sides, as the report files them. */
const SIDES: readonly Segment[] = [
  { key: 'owed', label: 'Receivables' },
  { key: 'owe', label: 'Payables' },
];

export function LendBorrowPage() {
  const { ws } = useApp();
  const phone = usePhone();
  const people = usePeopleDebts();
  // Opened from a person's row on Debts: that person alone, with the way back to everyone one tap away.
  const { person: only, side: asked } = useSearch({ from: '/net-worth/lend-borrow' });
  const navigate = useNavigate();
  const theirs = (list: PersonDebtRow[]) => (only ? list.filter((row) => row.personName === only) : list);
  const [showSettled, setShowSettled] = useState(false);
  // Which side the phone is showing. Null until the reader picks one, so the first paint shows something.
  const [side, setSide] = useState<Side | null>(null);

  const owedToYou = theirs(people.data?.owedToYou ?? []);
  const youOwe = theirs(people.data?.youOwe ?? []);
  const settled = theirs(people.data?.settled ?? []);
  const held = useHeldRates([...owedToYou, ...youOwe].map((person) => person.currency));
  const rates = held.data?.rates;
  const nothingYet = people.isSuccess && owedToYou.length === 0 && youOwe.length === 0 && settled.length === 0;
  // The reader's own pick wins over where the page was opened; `openingSide` says why each default is what it is.
  const shown: Side = side ?? openingSide({ asked, person: only, owedToYouCount: owedToYou.length });

  /*
   * + adds on a screen of its own. The phone shows one side, so + goes straight to that side's screen; the desktop
   * shows both, so + asks which. A person being shown travels along, so their name is already typed.
   */
  const carry = only ? { person: only } : {};
  const add = (to: Side): CornerAction => ({
    key: to,
    label: to === 'owed' ? 'New receivable' : 'New payable',
    to: newDebtPath(to),
    search: carry,
  });
  const plus = <Plus size={22} aria-hidden />;
  const actions: CornerAction[] = phone
    ? [{ ...add(shown), key: 'add', glyph: plus }]
    : [{ key: 'add', label: 'Add to Lend & borrow', glyph: plus, menu: [add('owed'), add('owe')] }];

  return (
    <div className={SCREEN}>
      {/*
       * A subpage of Cashflow, drawn as one: the circle at the top left is the way back to the list this moves
       * with, and its name sits in the middle of the bar. No section strip: this page left Net worth for Cashflow,
       * because money between you and people is money moving, and one honest way back says more than a strip with
       * nothing lit in it.
       */}
      <PushedTitle title="Lend & borrow" back="Cashflow" backTo="/transactions" actions={actions} />
      <ErrorBox error={people.error} />

      {only && (
        <InsetGroup header={`Only ${only}`}>
          <InsetRow title="Show everyone" to="/net-worth/lend-borrow" search={{}} />
        </InsetGroup>
      )}

      {nothingYet && (
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
          {showSettled && <PeopleRows people={settled} />}
        </>
      )}

    </div>
  );
}
