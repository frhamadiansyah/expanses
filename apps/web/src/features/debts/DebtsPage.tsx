import type { PersonDebtRow } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Button, Card, Empty, ErrorBox, Money, PageHeader } from '../../ui';
import { NetWorthTabs } from '../networth/NetWorthTabs';
import { DebtForm } from './DebtForm';
import { PersonCard } from './PersonCard';
import { usePeopleDebts } from './queries';

function Column({ title, people, emptyText, currency }: { title: string; people: PersonDebtRow[]; emptyText: string; currency: string }) {
  const totalMinor = people.reduce((total, person) => total + person.totalMinor, 0);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</span>
        <Money minor={totalMinor} currency={currency} className="font-semibold" />
      </div>
      {people.length === 0 && <p className="text-sm text-slate-500">{emptyText}</p>}
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Lend &amp; borrow"
        action={
          // While the inline form is open there is no action to show, and an empty row would still take its gap.
          !adding && (
            <div className="flex items-center gap-4">
              {/* The inline form is still one click away; the picker is for when you do not know what to call it. */}
              <Link to="/debts/new" className="text-sm font-medium text-slate-600 underline-offset-4 hover:underline">
                What do you owe?
              </Link>
              <Button onClick={() => setAdding(true)}>Add a loan</Button>
            </div>
          )
        }
      />
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
        <Card className="space-y-2">
          <button type="button" className="text-sm font-semibold" onClick={() => setShowSettled((open) => !open)}>
            {showSettled ? 'Hide' : 'Show'} settled ({settled.length})
          </button>
          {showSettled && (
            <div className="grid gap-3 md:grid-cols-2">
              {settled.map((person) => (
                <PersonCard key={`settled-${person.direction}-${person.personName}`} person={person} />
              ))}
            </div>
          )}
        </Card>
      )}

      <p className="text-xs text-slate-500">
        Lending is not spending: the money moves from your account to the person, and comes back the same way. Only interest counts as income or as a cost.
      </p>
    </div>
  );
}
