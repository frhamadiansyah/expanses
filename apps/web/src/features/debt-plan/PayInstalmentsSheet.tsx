import { formatMinor } from '@expanses/core';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { keptForSpending } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow } from '../../ui/native';
import { dayMonth } from '../networth/debt-rows';
import { payerChoices, spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { type LoanToPay, type PaidInstalments, payInstalments } from './pay-instalments';

/**
 * Pay several instalments (Mac Debt-free plan): what was ticked — or a late loan's every instalment, from its Pay all —
 * paid today from one account, each as the loan page's own Pay records it. The accounts offered and the first one picked
 * are that sheet's; the set-aside question is asked once about the total, and spread over the payments as Pay several
 * spreads it for bills (`payerChoices`).
 */
export function PayInstalmentsSheet({
  title,
  loans,
  totalMinor,
  today,
  onClose,
  onPaid,
}: {
  title: string;
  /** Each loan once, with how many of its instalments to pay, in the order they are paid. */
  loans: readonly (LoanToPay & { minor: number })[];
  /** What the ticked rows come to, as the Schedule shows them. */
  totalMinor: number;
  today: string;
  onClose: () => void;
  onPaid: (paid: PaidInstalments) => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const money = moneyHolders(accounts).filter((a) => keptForSpending(a));
  const [moneyId, setMoneyId] = useState('');
  const paidFrom = moneyId || money[0]?.id || '';
  const setAside = useSetAside(spendingDoor(paidFrom, totalMinor));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const currency = loans[0]?.currency ?? ws.baseCurrency;

  async function save() {
    if (busy || !paidFrom || !setAside.ready) return;
    setBusy(true);
    setError(null);
    const amounts = loans.flatMap((loan) => Array.from({ length: loan.count }, () => loan.minor / Math.max(1, loan.count)));
    const free = setAside.check.kind === 'ask' ? setAside.check.freeMinor : null;
    const promised = (setAside.check.kind === 'ask' && setAside.check.goals.find((goal) => goal.goalId === setAside.choice?.goalId)?.promisedMinor) || 0;
    const paid = await payInstalments(database, ws, { loans, moneyAccountId: paidFrom, today, setAside: payerChoices(setAside.choice, amounts, free, promised) });
    await invalidate();
    setBusy(false);
    if (paid.error && paid.ids.length === 0) {
      setError(paid.error);
      return;
    }
    onPaid(paid);
  }

  return (
    <Sheet grouped title={title} onClose={onClose} confirm={{ label: 'Save payments', disabled: busy || !paidFrom || !setAside.ready, run: () => void save() }}>
      <InsetGroup>
        {loans.map((loan) => (
          <InsetRow
            key={loan.accountId}
            title={loan.name}
            chevron={false}
            valueTone="ink"
            value={`${loan.count} ${loan.count === 1 ? 'instalment' : 'instalments'} · ${formatMinor(loan.minor, loan.currency)}`}
          />
        ))}
        <InsetRow title="Total" chevron={false} valueTone="ink" value={<span className="font-semibold">{formatMinor(totalMinor, currency)}</span>} />
      </InsetGroup>
      <InsetGroup footer="Each is recorded as the loan’s own Pay records it: the schedule’s principal and interest, dated today. A payment settles the loan’s oldest instalment still unpaid.">
        <SelectRow label="Paid from" value={paidFrom} onChange={(e) => setMoneyId(e.target.value)}>
          {money.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectRow>
        <InsetRow title="Paid on" chevron={false} valueTone="ink" value={`Today, ${dayMonth(today)}`} />
      </InsetGroup>
      {setAside.node}
      <ErrorBox error={error} />
    </Sheet>
  );
}
