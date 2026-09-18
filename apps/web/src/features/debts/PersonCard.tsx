import { type DebtDirection, dueLabel, hartaLabel, isoDate, utangLabel } from '@expanses/core';
import { forgiveRemainder, type PersonDebtRow, recordRepayment, saveDebtProfile } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, ErrorBox, Field, Input, Money, Select } from '../../ui';
import { personCodeChoices } from '../ownables/catalogue-view';
import { useDebtHistory, useDebtProfiles } from './queries';
import { emptyRepaymentDraft, type RepaymentDraft, repaymentDraftToInput } from './debts-form';

const DUE_PILL: Record<string, string> = {
  overdue: 'bg-red-100 text-red-800',
  due_soon: 'bg-amber-100 text-amber-800',
  none: 'bg-slate-100 text-slate-600',
};

const HISTORY_LABELS: Record<string, string> = { lend: 'Lent', repayment: 'Repayment', forgive: 'Forgiven' };

/** Accounts money can come from or go to. A receivable holds a person's debt, not money. */
function History({ accountId, currency }: { accountId: string; currency: string }) {
  const history = useDebtHistory(accountId);
  if ((history.data?.length ?? 0) === 0) return null;
  return (
    <div className="divide-y divide-slate-100 text-xs">
      {(history.data ?? []).map((row) => (
        <div key={row.transactionId} className="flex items-baseline justify-between gap-3 py-1">
          <span className="text-slate-500">{row.occurredOn}</span>
          <span className="flex-1">
            {HISTORY_LABELS[row.kind]}
            {row.interestMinor > 0 && (
              <>
                {' · interest '}
                <Money minor={row.interestMinor} currency={currency} />
              </>
            )}
          </span>
          <Money minor={row.amountMinor} currency={currency} />
        </div>
      ))}
    </div>
  );
}

/**
 * What one loan between people files as, changed here.
 *
 * Money owed to you is harta — a piutang, and which of the three depends on whether the borrower is a customer,
 * a relative, or neither. Money you owe is utang, and never 102: a credit card has a card's own form. The rest
 * of the profile is written back untouched, so choosing a code changes the code alone.
 */
function DebtCodeField({ accountId, direction }: { accountId: string; direction: DebtDirection }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const profile = (useDebtProfiles().data ?? []).find((row) => row.accountId === accountId);
  const [error, setError] = useState<unknown>(null);
  if (!profile) return null;
  const naming = direction === 'lent' ? hartaLabel : utangLabel;

  async function choose(coretaxCode: string) {
    if (!profile) return;
    setError(null);
    try {
      await saveDebtProfile(database, ws, {
        accountId: profile.accountId,
        personName: profile.personName,
        personIdNumber: profile.personIdNumber,
        reason: profile.reason,
        dueOn: profile.dueOn,
        coretaxCode,
      });
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="max-w-sm space-y-1">
      <Field label="Tax report code" hint={naming(profile.coretaxCode) || 'Not a code the form knows.'}>
        <Select value={profile.coretaxCode} onChange={(e) => void choose(e.target.value)}>
          {personCodeChoices(direction).map((choice) => (
            <option key={choice.code} value={choice.code}>
              {choice.label}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorBox error={error} />
    </div>
  );
}

/** One person: what they owe in total, each loan behind it, and the two things you can do about it. */
export function PersonCard({ person }: { person: PersonDebtRow }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  // Somewhere money can actually sit: never another person's account.
  const moneyAccounts = accounts.filter((account) => SPENDABLE_SUBTYPES.includes(account.subtype) && account.archivedAt === null);
  const today = isoDate();
  const [repayingId, setRepayingId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState<RepaymentDraft>(() => emptyRepaymentDraft(today, moneyAccounts[0]?.id ?? ''));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const back = person.direction === 'lent' ? 'came back' : 'you paid';

  async function saveRepayment(accountId: string, balanceMinor: number) {
    setError(null);
    setBusy(true);
    try {
      const input = repaymentDraftToInput({ ...draft, moneyId: draft.moneyId || moneyAccounts[0]?.id || '' }, accountId, person.currency, balanceMinor, person.personName);
      await recordRepayment(database, ws, input);
      await invalidate();
      setRepayingId(null);
      setDraft(emptyRepaymentDraft(today, moneyAccounts[0]?.id ?? ''));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function forgive(accountId: string) {
    if (!window.confirm(`Forgive what ${person.personName} still owes? It becomes a gift, and the debt closes.`)) return;
    setError(null);
    try {
      await forgiveRemainder(database, ws, { debtAccountId: accountId, occurredOn: today });
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{person.personName}</h3>
        <span className="flex items-center gap-2">
          {person.dueState !== 'none' && (
            <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', DUE_PILL[person.dueState])}>
              {person.dueState === 'overdue' ? 'Overdue' : 'Due soon'}
            </span>
          )}
          <Money minor={person.totalMinor} currency={person.currency} className="font-semibold" />
        </span>
      </div>

      <div className="divide-y divide-slate-100 text-sm">
        {person.loans.map((loan) => {
          const label = dueLabel(loan.dueOn, today, loan.status);
          return (
            <div key={loan.accountId} className="space-y-1 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0">
                  {loan.reason || 'No reason noted'}
                  <span className="text-xs text-slate-500">
                    {' · since '}
                    {loan.openedOn}
                    {label && ` · ${label}`}
                    {loan.status !== 'open' && ` · ${loan.status}`}
                  </span>
                </span>
                <Money minor={loan.balanceMinor} currency={loan.currency} />
              </div>
              {loan.originalMinor > 0 && (
                <div className="h-1.5 rounded-full bg-slate-100" title={`${Math.round((loan.repaidMinor / loan.originalMinor) * 100)}% back`}>
                  <i className="block h-1.5 rounded-full bg-emerald-600" style={{ width: `${Math.min(100, (loan.repaidMinor / loan.originalMinor) * 100)}%` }} />
                </div>
              )}
              {loan.status === 'open' && repayingId !== loan.accountId && (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setRepayingId(loan.accountId)}>
                    Record repayment
                  </Button>
                  <Button variant="ghost" onClick={() => void forgive(loan.accountId)}>
                    Forgive rest
                  </Button>
                </div>
              )}
              {repayingId === loan.accountId && (
                <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                  <div className="grid gap-3 md:grid-cols-4">
                    <Field label={`How much ${back} (${loan.currency})`}>
                      <Input value={draft.amount} inputMode="decimal" onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="3.000.000" />
                    </Field>
                    <Field label={`Interest (${loan.currency})`} hint="Leave empty when there is none.">
                      <Input value={draft.interest} inputMode="decimal" onChange={(e) => setDraft({ ...draft, interest: e.target.value })} />
                    </Field>
                    <Field label="Date">
                      <Input type="date" value={draft.occurredOn} max={today} onChange={(e) => setDraft({ ...draft, occurredOn: e.target.value })} />
                    </Field>
                    <Field label={person.direction === 'lent' ? 'Into' : 'From'}>
                      <Select value={draft.moneyId} onChange={(e) => setDraft({ ...draft, moneyId: e.target.value })}>
                        {moneyAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    <Button disabled={busy} onClick={() => void saveRepayment(loan.accountId, loan.balanceMinor)}>
                      Save repayment
                    </Button>
                    <Button variant="ghost" onClick={() => setRepayingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {/* Never shown while choosing who owes what; shown here, where it can be put right. */}
              <DebtCodeField accountId={loan.accountId} direction={person.direction} />
            </div>
          );
        })}
      </div>

      <ErrorBox error={error} />
      <button type="button" className="text-xs text-slate-600 underline" onClick={() => setShowHistory((open) => !open)}>
        {showHistory ? 'Hide history' : 'Show history'}
      </button>
      {showHistory && person.loans.map((loan) => <History key={loan.accountId} accountId={loan.accountId} currency={loan.currency} />)}
    </Card>
  );
}
