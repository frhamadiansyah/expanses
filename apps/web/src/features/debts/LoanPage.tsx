import { isoDate } from '@expanses/core';
import { forgiveRemainder, listDebtProfiles, saveDebtProfile } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { Plus, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { personCodeChoices } from '../ownables/catalogue-view';
import { personParams, repaymentWord, shortDay } from './lend-borrow-view';
import { useDebtHistory, useDebtProfiles, usePeopleDebts } from './queries';
import { RepaymentForm } from './RepaymentForm';

const HISTORY_TITLES: Record<string, string> = { lend: 'Lent', repayment: 'Repayment', forgive: 'Forgiven' };

/**
 * One loan, on a page of its own: what is left of it, the two things to do about it, what it is and what happened.
 *
 * Everything that used to crowd the person's card under every loan — Record repayment, Forgive rest, the boxed
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

  const anyBack = loan.repaidMinor > 0;

  return (
    <div className={SCREEN}>
      {/* A plain word in the bar: a loan's own name can be too long for it, and is shown, and changed, in Details. */}
      <PushedTitle
        title="Loan"
        back={person.personName}
        backTo="/net-worth/lend-borrow/$side/$person"
        backParams={back}
        actions={[]}
      />

      <section className="flex flex-col items-center gap-1 pb-[18px] text-center" data-testid="loan-hero">
        <Money minor={loan.balanceMinor} currency={loan.currency} className="text-[34px] leading-[40px] font-bold tracking-[-0.02em]" />
        <span className="text-[13px] leading-[17px] text-[var(--ph-ink-3)]">
          {'of '}
          <Money minor={loan.originalMinor} currency={loan.currency} />
          {person.direction === 'lent' ? ' lent' : ' borrowed'}
          {anyBack ? (
            <>
              {' · '}
              <Money minor={loan.repaidMinor} currency={loan.currency} />
              {' back'}
            </>
          ) : (
            ' · nothing back yet'
          )}
        </span>
        {loan.originalMinor > 0 && (
          <span className="mt-2 block h-1.5 w-full max-w-sm rounded-full bg-[var(--ph-track)]" aria-hidden>
            <i className="block h-1.5 rounded-full bg-[var(--ph-tint)]" style={{ width: `${Math.min(100, (loan.repaidMinor / loan.originalMinor) * 100)}%` }} />
          </span>
        )}
      </section>

      {/*
        The loan's two actions as round buttons under the figure they change, as Wallet and Contacts draw theirs: the
        repayment filled in the app's green, forgiving on a plain surface in red. Repaying opens a sheet over the page.
      */}
      {loan.status === 'open' && (
        <div className="mb-[22px] flex justify-center gap-[44px]">
          <RoundAction
            label={repaymentWord(person.direction)}
            name={`Record ${repaymentWord(person.direction).toLowerCase()}`}
            onClick={() => setRepaying(true)}
            filled
          >
            <Plus size={24} aria-hidden />
          </RoundAction>
          <RoundAction label="Forgive" name="Forgive rest" onClick={() => void forgive()}>
            <X size={24} aria-hidden />
          </RoundAction>
        </div>
      )}
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
          <TextRow
            label="Due by"
            type="date"
            value={profile.dueOn ?? ''}
            onChange={(e) => void saveField({ dueOn: e.target.value || null })}
          />
        </InsetGroup>
      )}

      {(history.data?.length ?? 0) > 0 && (
        <InsetGroup header="History">
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

/** A round button with its word under it: `name` is what it does in full, for a screen reader and a test. */
function RoundAction({ label, name, onClick, filled = false, children }: { label: string; name: string; onClick: () => void; filled?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={name} className="ph-focus flex flex-col items-center gap-[6px] rounded-[12px]">
      <span
        className={
          filled
            ? 'flex h-[54px] w-[54px] items-center justify-center rounded-full bg-[var(--ph-tint)] text-[var(--ph-surface)]'
            : 'flex h-[54px] w-[54px] items-center justify-center rounded-full bg-[var(--ph-surface)] text-[var(--ph-alarm)]'
        }
      >
        {children}
      </span>
      <span className="text-[12px] leading-[16px] text-[var(--ph-ink-2)]" aria-hidden>
        {label}
      </span>
    </button>
  );
}
