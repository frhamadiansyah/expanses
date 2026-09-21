import type { PersonDebtRow } from '@expanses/db';
import { HelpCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Empty, ErrorBox, Money } from '../../ui';
import { type CornerAction, InsetGroup, InsetRow, LargeTitle } from '../../ui/native';
import { NetWorthTabs } from '../networth/NetWorthTabs';
import { PanelHeader, SCREEN } from '../networth/Panel';
import { DebtForm } from './DebtForm';
import { PersonCard } from './PersonCard';
import { usePeopleDebts } from './queries';

/**
 * One side of the ledger.
 *
 * "Owed to you" and "You owe" were headings *inside* cards; they are group headers now, outside and above what
 * they name, with the side's total beside them. That is the one thing the audit asks of this screen.
 */
function Column({ title, people, emptyText, currency }: { title: string; people: PersonDebtRow[]; emptyText: string; currency: string }) {
  const totalMinor = people.reduce((total, person) => total + person.totalMinor, 0);
  return (
    <div>
      <PanelHeader title={title} trailing={<Money minor={totalMinor} currency={currency} />} />
      {people.length === 0 && <p className="px-[4px] pb-[18px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">{emptyText}</p>}
      {people.map((person) => (
        <PersonCard key={`${person.direction}-${person.personName}`} person={person} />
      ))}
    </div>
  );
}

export function DebtsPage() {
  const { ws } = useApp();
  const people = usePeopleDebts();
  const [adding, setAdding] = useState(false);
  const [showSettled, setShowSettled] = useState(false);

  const owedToYou = people.data?.owedToYou ?? [];
  const youOwe = people.data?.youOwe ?? [];
  const settled = people.data?.settled ?? [];
  const nothingYet = people.isSuccess && owedToYou.length === 0 && youOwe.length === 0 && settled.length === 0;

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
      <NetWorthTabs />
      <ErrorBox error={people.error} />

      {adding && <DebtForm onDone={() => setAdding(false)} />}

      {nothingYet && !adding && (
        <Empty>
          Nothing lent or borrowed yet. Money you lend leaves your cash and waits under "Owed to you"; money you borrow shows as a debt until you pay it back.
        </Empty>
      )}

      {!nothingYet && (
        <div className="grid gap-6 md:grid-cols-2">
          <Column title="Owed to you" people={owedToYou} emptyText="Nobody owes you anything." currency={ws.baseCurrency} />
          <Column title="You owe" people={youOwe} emptyText="You owe nobody." currency={ws.baseCurrency} />
        </div>
      )}

      {settled.length > 0 && (
        <>
          <InsetGroup>
            <InsetRow title={`${showSettled ? 'Hide' : 'Show'} settled (${settled.length})`} chevron={false} onClick={() => setShowSettled((open) => !open)} />
          </InsetGroup>
          {showSettled && (
            <div className="grid gap-x-6 md:grid-cols-2">
              {settled.map((person) => (
                <PersonCard key={`settled-${person.direction}-${person.personName}`} person={person} />
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
