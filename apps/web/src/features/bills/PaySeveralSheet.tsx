import { parseMajor, spreadOver } from '@expanses/core';
import { type MonthlyBill, recordBillPayments, type SetAsideChoice } from '@expanses/db';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Input, Money } from '../../ui';
import { spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { pillOf } from './bill-view';

interface PayerAnswer {
  choice: SetAsideChoice | null;
  ready: boolean;
  /** What the account had free when the question asked; null when it did not ask. */
  freeMinor: number | null;
}

/**
 * One paying account's question, asked about everything the sheet pays from it together: several bills from one
 * account can each fit what is free and still, added up, take more than is free.
 */
function PayerQuestion({ accountId, total, onChange }: { accountId: string; total: number; onChange: (accountId: string, answer: PayerAnswer) => void }) {
  const setAside = useSetAside(spendingDoor(accountId, total));
  const freeMinor = setAside.check.kind === 'ask' ? setAside.check.freeMinor : null;
  const { choice, ready } = setAside;
  const key = JSON.stringify({ choice, ready, freeMinor });
  useEffect(() => {
    onChange(accountId, { choice, ready, freeMinor });
    // Keyed on what the answer says, not on the object's identity, which is new on every render.
  }, [accountId, key]);
  return <>{setAside.node}</>;
}

/**
 * Paying several bills on one day: the ticked bills each become their own payment against their own
 * category, so a fixed one needs nothing typed and one that varies asks what it came to. Unticking a bill
 * here leaves it exactly as it was — a way to change your mind before anything is recorded.
 */
export function PaySeveralSheet({
  bills,
  picked,
  today,
  onClose,
  onPaid,
}: {
  /** Every unsettled bill this month, so the sheet can offer more than what was picked on the list. */
  bills: MonthlyBill[];
  picked: ReadonlySet<string>;
  today: string;
  onClose: () => void;
  /** The recorded transactions and the names of the bills they paid — what was ticked here, not on the list. */
  onPaid: (ids: string[], names: string[]) => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const currencyOf = (moneyAccountId: string) => accounts.find((account) => account.id === moneyAccountId)?.currency ?? ws.baseCurrency;

  // The picked bills lead, since that is what was chosen on the list; the rest follow in the order they came in.
  const ordered = [...bills.filter((bill) => picked.has(bill.id)), ...bills.filter((bill) => !picked.has(bill.id))];

  const [ticked, setTicked] = useState<Set<string>>(() => new Set(picked));
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, PayerAnswer>>({});

  const chosen = bills.filter((bill) => ticked.has(bill.id));
  /** The figure each bill posts: the fixed amount, or what was typed for one that varies (0 until it parses). */
  const amountOf = (bill: MonthlyBill) => {
    if (bill.amountMinor !== null) return bill.amountMinor;
    try {
      return parseMajor(amounts[bill.id]?.trim() ?? '', currencyOf(bill.moneyAccountId));
    } catch {
      return 0;
    }
  };
  const payers = [...new Set(chosen.map((bill) => bill.moneyAccountId))];
  const totalFrom = (payer: string) => chosen.filter((bill) => bill.moneyAccountId === payer).reduce((sum, bill) => sum + amountOf(bill), 0);
  const answered = payers.every((payer) => answers[payer]?.ready === true);
  const onAnswer = (accountId: string, answer: PayerAnswer) => setAnswers((current) => ({ ...current, [accountId]: answer }));

  const toggle = (id: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function record() {
    if (!answered) return;
    setError(null);
    setBusy(true);
    try {
      // What went over the free money, spread across each account's payments in order: a bill that still fit
      // what was free carries no answer, and the ones after it carry what they took beyond it.
      const overs = new Map<string, number[]>();
      for (const payer of payers) {
        const answer = answers[payer];
        const mine = chosen.filter((bill) => bill.moneyAccountId === payer);
        overs.set(payer, answer?.choice && answer.freeMinor !== null ? spreadOver(mine.map(amountOf), answer.freeMinor) : mine.map(() => 0));
      }
      const payments = chosen.map((bill) => {
        const currency = currencyOf(bill.moneyAccountId);
        const typed = amounts[bill.id]?.trim();
        const index = chosen.filter((other) => other.moneyAccountId === bill.moneyAccountId).indexOf(bill);
        const over = overs.get(bill.moneyAccountId)![index]!;
        const choice = answers[bill.moneyAccountId]?.choice;
        return {
          templateId: bill.id,
          billMonth: bill.billMonth,
          // Parsed here as it always was, so a figure that does not parse still says so.
          amountMinor: bill.amountMinor ?? (typed ? parseMajor(typed, currency) : 0),
          setAside: choice && over > 0 ? { ...choice, overMinor: over } : null,
        };
      });
      if (payments.some((payment) => !(payment.amountMinor > 0))) {
        setError('Enter the amount of each ticked bill that varies');
        return;
      }
      const ids = await recordBillPayments(database, ws, { paidOn, payments });
      await invalidate();
      onPaid(ids, chosen.map((bill) => bill.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Pay several" onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-xl ring-1 ring-slate-200">
          {ordered.map((bill) => (
            <div key={bill.id} className="flex min-h-12 items-center gap-3 border-t border-slate-100 px-3 first:border-t-0">
              <input
                type="checkbox"
                className="h-5 w-5"
                aria-label={`Pay ${bill.name}`}
                checked={ticked.has(bill.id)}
                onChange={() => toggle(bill.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{bill.name}</span>
                <span className="block text-xs text-slate-500">{pillOf(bill).text}</span>
              </span>
              {bill.amountMinor !== null ? (
                <Money minor={bill.amountMinor} currency={currencyOf(bill.moneyAccountId)} />
              ) : (
                <Input
                  className="w-32"
                  inputMode="decimal"
                  aria-label={`What ${bill.name} came to`}
                  placeholder="Amount"
                  value={amounts[bill.id] ?? ''}
                  onChange={(e) => setAmounts((current) => ({ ...current, [bill.id]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <label htmlFor="several-on" className="text-sm">
            Paid on
          </label>
          <Input id="several-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="w-auto" />
        </div>

        {payers.map((payer) => (
          <PayerQuestion key={payer} accountId={payer} total={totalFrom(payer)} onChange={onAnswer} />
        ))}

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <Button onClick={() => void record()} disabled={ticked.size === 0 || busy || !answered} className="w-full">
          {ticked.size === 0 ? 'Record' : `Record ${ticked.size} ${ticked.size === 1 ? 'bill' : 'bills'}`}
        </Button>
      </div>
    </Sheet>
  );
}
