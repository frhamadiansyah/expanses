import { isoDate } from '@expanses/core';
import { listDebtProfiles, saveDebtProfile } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { personCodeChoices } from '../ownables/catalogue-view';
import { Empty, ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN, TextRow } from '../../ui/native';
import { loanSubtitle } from './lend-borrow-view';
import { useDebtProfiles, usePeopleDebts } from './queries';
import { newDebtPath, type Side } from './sides';

/**
 * One person, on a page of their own: what they owe in all, each of their loans as a row, and their tax ID.
 *
 * The list shows one row per person; this is where their loans are told apart — the motorcycle repair and the laptop,
 * each with its own date, sub-category and due date — and each opens on its own page, where it is repaid, forgiven or
 * changed. + here adds a loan with this person already named.
 */
export function PersonPage() {
  const { side, person: name } = useParams({ from: '/net-worth/lend-borrow/$side/$person' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const people = usePeopleDebts();
  const profiles = useDebtProfiles();
  const [error, setError] = useState<unknown>(null);
  const direction = (side as Side) === 'owe' ? 'borrowed' : 'lent';

  // A person can have loans in more than one currency; each currency is a row of its own on the list, all of them
  // this one person here.
  const rows = [...(people.data?.owedToYou ?? []), ...(people.data?.youOwe ?? []), ...(people.data?.settled ?? [])].filter(
    (row) => row.personName === name && row.direction === direction,
  );
  const loans = rows.flatMap((row) => row.loans);
  const openLoans = loans.filter((loan) => loan.status === 'open');
  const closedLoans = loans.filter((loan) => loan.status !== 'open');
  const theirs = (profiles.data ?? []).filter((profile) => profile.personName === name && profile.direction === direction);
  // The sub-category in the picker's own English words, never the report's Indonesian name for it.
  const choices = personCodeChoices(direction);
  const codeOf = (accountId: string) => {
    const code = theirs.find((profile) => profile.accountId === accountId)?.coretaxCode ?? '';
    return choices.find((choice) => choice.code === code)?.label ?? '';
  };
  const idNumber = theirs.find((profile) => profile.personIdNumber)?.personIdNumber ?? '';

  /** A tax ID belongs to the person, so it is written onto every loan they hold. */
  async function saveIdNumber(value: string) {
    setError(null);
    try {
      // Read fresh, for the reason `LoanPage.saveField` does: a profile is saved whole.
      const current = (await listDebtProfiles(database, ws)).filter((row) => row.personName === name && row.direction === direction);
      for (const profile of current) {
        await saveDebtProfile(database, ws, {
          accountId: profile.accountId,
          personName: profile.personName,
          personIdNumber: value || null,
          reason: profile.reason,
          dueOn: profile.dueOn,
          coretaxCode: profile.coretaxCode,
        });
      }
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const add = {
    key: 'add',
    label: direction === 'lent' ? `New loan to ${name}` : `New loan from ${name}`,
    glyph: <Plus size={22} aria-hidden />,
    to: newDebtPath(side as Side),
    search: { person: name },
  };

  return (
    <div className={SCREEN}>
      <PushedTitle title={name} back="Lend & borrow" backTo="/net-worth/lend-borrow" backSearch={{ side }} actions={[add]} />
      {people.isSuccess && rows.length === 0 && <Empty>Nothing is owed between you and {name} any more.</Empty>}

      {rows.length > 0 && (
        // The total alone under their name, as Wallet draws a payment: the list below says the rest.
        <section className="flex flex-col items-center gap-1 pb-[22px] text-center" data-testid="person-hero">
          {rows.map((row) => (
            <Money key={row.currency} minor={row.totalMinor} currency={row.currency} className="text-[34px] leading-[40px] font-bold tracking-[-0.02em]" />
          ))}
        </section>
      )}

      {openLoans.length > 0 && (
        <InsetGroup header="Open loans">
          {openLoans.map((loan) => (
            <InsetRow
              key={loan.accountId}
              title={loan.reason?.trim() || 'No reason noted'}
              subtitle={loanSubtitle(loan, codeOf(loan.accountId), today)}
              value={<Money minor={loan.balanceMinor} currency={loan.currency} />}
              valueTone="ink"
              to="/net-worth/lend-borrow/loan/$accountId"
              params={{ accountId: loan.accountId }}
              testId="loan-row"
            />
          ))}
        </InsetGroup>
      )}

      {closedLoans.length > 0 && (
        <InsetGroup header="Settled and forgiven">
          {closedLoans.map((loan) => (
            <InsetRow
              key={loan.accountId}
              title={loan.reason?.trim() || 'No reason noted'}
              subtitle={loanSubtitle(loan, codeOf(loan.accountId), today)}
              value={<Money minor={loan.originalMinor} currency={loan.currency} />}
              to="/net-worth/lend-borrow/loan/$accountId"
              params={{ accountId: loan.accountId }}
            />
          ))}
        </InsetGroup>
      )}

      {theirs.length > 0 && (
        <InsetGroup header="Tax ID">
          <TextRow
            key={`id-${idNumber}`}
            label="Tax ID"
            info="A national or tax identification number. Optional; needed only when a loan appears in a tax report."
            defaultValue={idNumber}
            inputMode="numeric"
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (value !== idNumber) void saveIdNumber(value);
            }}
          />
        </InsetGroup>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
