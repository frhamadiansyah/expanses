import { formatMinor, isoDate } from '@expanses/core';
import { deleteLoan, forgiveRemainder, listDebtProfiles, saveDebtProfile } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Gift, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { personCodeChoices } from '../ownables/catalogue-view';
import { deleteLoanQuestion, loanFigureLabels, personParams, repaymentWord, shortDay } from './lend-borrow-view';
import { useDebtHistory, useDebtProfiles, usePeopleDebts } from './queries';
import { RepaymentForm } from './RepaymentForm';

const HISTORY_TITLES: Record<string, string> = { lend: 'Lent', repayment: 'Repayment', forgive: 'Forgiven' };

/**
 * One loan, on a page of its own: what is left of it, the two things to do about it, what it is and what happened.
 *
 * Everything that used to crowd the person's card under every loan — Record repayment, Forgive the rest, the boxed
 * tax-code picker, a Show history link — lives here, and the card is a list of rows again. What it is for (Loan), the due
 * date and the sub-category were written once when the money moved and could never be changed; they are rows that
 * save as they are changed.
 */
export function LoanPage() {
  const { accountId } = useParams({ from: '/net-worth/lend-borrow/loan/$accountId' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const people = usePeopleDebts();
  const profiles = useDebtProfiles();
  const history = useDebtHistory(accountId);
  const [repaying, setRepaying] = useState(false);
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);

  const all = [...(people.data?.owedToYou ?? []), ...(people.data?.youOwe ?? []), ...(people.data?.settled ?? [])];
  const person = all.find((row) => row.loans.some((loan) => loan.accountId === accountId));
  const loan = person?.loans.find((row) => row.accountId === accountId);
  const profile = (profiles.data ?? []).find((row) => row.accountId === accountId);

  if (people.isSuccess && (!person || !loan)) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Loan" back="Lend & borrow" backTo="/net-worth/lend-borrow" actions={[]} />
        <Empty>This loan is not on the list any more.</Empty>
      </div>
    );
  }
  if (!person || !loan) return <div className={SCREEN} />;

  const back = personParams(person);

  /**
   * Writes one field of the loan's profile, leaving the rest exactly as it was — as it is in the database now, not as
   * this screen last read it. A profile is saved whole, so building it from the screen let a due date typed straight
   * after a reason write the old reason back over the new one, before the screen had read the first save.
   */
  async function saveField(patch: { reason?: string | null; dueOn?: string | null; coretaxCode?: string }) {
    setError(null);
    try {
      const current = (await listDebtProfiles(database, ws)).find((row) => row.accountId === accountId);
      if (!current) return;
      await saveDebtProfile(database, ws, {
        accountId: current.accountId,
        personName: current.personName,
        personIdNumber: current.personIdNumber,
        reason: current.reason,
        dueOn: current.dueOn,
        coretaxCode: current.coretaxCode,
        ...patch,
      });
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  /**
   * For a loan entered by mistake: everything it moved is taken back and the loan goes. Back to the person when they
   * have other loans, to Lend & borrow when this was their only one.
   */
  async function remove() {
    const moneyBack = (history.data ?? []).filter((row) => row.kind === 'repayment').length;
    if (!window.confirm(deleteLoanQuestion(person!.direction, moneyBack))) return;
    setError(null);
    try {
      await deleteLoan(database, ws, accountId);
      await invalidate();
      if (person!.loans.length > 1) await navigate({ to: '/net-worth/lend-borrow/$side/$person', params: personParams(person!) });
      else await navigate({ to: '/net-worth/lend-borrow', search: { side: personParams(person!).side } });
    } catch (e) {
      setError(e);
    }
  }

  async function forgive() {
    if (!window.confirm(`Forgive what ${person!.personName} still owes? It becomes a gift, and the debt closes.`)) return;
    setError(null);
    try {
      await forgiveRemainder(database, ws, { debtAccountId: accountId, occurredOn: today });
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }


  return (
    <div className={SCREEN}>
      {/* A plain word in the bar: a loan's own name can be too long for it, and is shown, and changed, in Details. */}
      <PushedTitle
        title="Loan"
        back={person.personName}
        backTo="/net-worth/lend-borrow/$side/$person"
        backParams={back}
        actions={[
          /*
           * The two rare, final things sit behind ⋯ at the top right: forgiving keeps the history and counts the rest
           * as a gift; deleting is for a loan entered by mistake.
           */
          {
            key: 'more',
            label: 'More',
            glyph: <MoreHorizontal size={20} aria-hidden />,
            menu: [
              ...(loan.status === 'open'
                ? [{ key: 'forgive', label: 'Forgive the rest', glyph: <Gift size={17} aria-hidden />, run: () => void forgive() }]
                : []),
              { key: 'delete', label: 'Delete loan', glyph: <Trash2 size={17} aria-hidden />, run: () => void remove() },
            ],
          },
        ]}
      />

      {/* What is still owed, alone, as Wallet draws a payment: what was lent and what came back are rows in Details. */}
      <section className="flex flex-col items-center gap-1 pb-[18px] text-center" data-testid="loan-hero">
        <Money minor={loan.balanceMinor} currency={loan.currency} className="text-[34px] leading-[40px] font-bold tracking-[-0.02em]" />
      </section>

      {repaying && (
        <RepaymentForm
          debtAccountId={accountId}
          direction={person.direction}
          currency={loan.currency}
          personName={person.personName}
          balanceMinor={loan.balanceMinor}
          onDone={() => setRepaying(false)}
        />
      )}

      <ErrorBox error={error} />

      {profile && (
        <InsetGroup header="Details">
          <SelectRow label="Type" value={profile.coretaxCode} onChange={(e) => void saveField({ coretaxCode: e.target.value })}>
            {personCodeChoices(person.direction).map((choice) => (
              <option key={choice.code} value={choice.code}>
                {choice.label}
              </option>
            ))}
            {/* A code the list no longer offers stays shown, rather than the row claiming the first choice. */}
            {!personCodeChoices(person.direction).some((choice) => choice.code === profile.coretaxCode) && (
              <option value={profile.coretaxCode}>{profile.coretaxCode}</option>
            )}
          </SelectRow>
          {/* Whose loan it is, as the new-loan form asks it: shown, not changed — moving a loan to someone else is not an edit. */}
          <TextRow label="Person" value={person.personName} readOnly />
          <TextRow
            key={`reason-${profile.reason ?? ''}`}
            label="Loan"
            defaultValue={profile.reason ?? ''}
            placeholder="Purpose"
            onBlur={(e) => {
              const reason = e.target.value.trim() || null;
              if (reason !== (profile.reason ?? null)) void saveField({ reason });
            }}
          />
          <TextRow label={loanFigureLabels(person.direction).given} value={formatMinor(loan.originalMinor, loan.currency)} readOnly />
          <TextRow label={loanFigureLabels(person.direction).back} value={formatMinor(loan.repaidMinor, loan.currency)} readOnly />
          <TextRow
            label="Due by"
            type="date"
            value={profile.dueOn ?? ''}
            onChange={(e) => void saveField({ dueOn: e.target.value || null })}
          />
        </InsetGroup>
      )}

      {/*
        Recording money back is the first row of History, where the entry it makes appears; forgiving, done once and
        rarely, waits in red at the foot of the page. Both go when the loan is finished.
      */}
      {((history.data?.length ?? 0) > 0 || loan.status === 'open') && (
        <InsetGroup header="History">
          {loan.status === 'open' ? (
            <InsetRow
              key="record"
              icon={<Plus size={16} strokeWidth={2.5} aria-hidden />}
              iconColour="var(--ph-tint)"
              title={`Record ${repaymentWord(person.direction).toLowerCase()}`}
              chevron={false}
              onClick={() => setRepaying(true)}
            />
          ) : null}
          {(history.data ?? []).map((row) => (
            <InsetRow
              key={row.transactionId}
              title={row.kind === 'repayment' ? repaymentWord(person.direction) : (HISTORY_TITLES[row.kind] ?? row.kind)}
              subtitle={
                row.interestMinor > 0 ? (
                  <>
                    {shortDay(row.occurredOn, today)}
                    {' · interest '}
                    <Money minor={row.interestMinor} currency={loan.currency} />
                  </>
                ) : (
                  shortDay(row.occurredOn, today)
                )
              }
              value={<Money minor={row.amountMinor} currency={loan.currency} />}
              chevron={false}
            />
          ))}
        </InsetGroup>
      )}

    </div>
  );
}

