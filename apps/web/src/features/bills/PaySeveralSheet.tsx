import { parseMajor } from '@expanses/core';
import { type MonthlyBill, recordBillPayments, type SetAsideChoice } from '@expanses/db';
import { type ReactNode, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Check } from 'lucide-react';
import { cx, ErrorBox, Money } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, ROW_PAD_X, ROW_PAD_Y, rowHeight, TextRow } from '../../ui/native';
import { payerChoices, spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { pillOf } from './bill-view';

interface PayerAnswer {
  choice: SetAsideChoice | null;
  ready: boolean;
  /** What the account had free when the question asked; null when it did not ask. */
  freeMinor: number | null;
  /** What the goal picked promised on the account, in its money; 0 when nothing was picked. */
  promisedMinor: number;
}

/**
 * One paying account's question, asked about everything the sheet pays from it together: several bills from one
 * account can each fit what is free and still, added up, take more than is free.
 */
function PayerQuestion({ accountId, total, onChange }: { accountId: string; total: number; onChange: (accountId: string, answer: PayerAnswer) => void }) {
  const setAside = useSetAside(spendingDoor(accountId, total));
  const freeMinor = setAside.check.kind === 'ask' ? setAside.check.freeMinor : null;
  const { choice, ready } = setAside;
  const promisedMinor = (setAside.check.kind === 'ask' && setAside.check.goals.find((goal) => goal.goalId === choice?.goalId)?.promisedMinor) || 0;
  const key = JSON.stringify({ choice, ready, freeMinor, promisedMinor });
  useEffect(() => {
    onChange(accountId, { choice, ready, freeMinor, promisedMinor });
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
      // Each account's answer, laid over its payments in order: a borrow is what went over the free money, spread; a
      // spend is the whole of each payment up to the promise, as one payment of the same total would be.
      const carried = new Map<string, (SetAsideChoice | null)[]>();
      for (const payer of payers) {
        const answer = answers[payer];
        const mine = chosen.filter((bill) => bill.moneyAccountId === payer);
        carried.set(payer, payerChoices(answer?.choice ?? null, mine.map(amountOf), answer?.freeMinor ?? null, answer?.promisedMinor ?? 0));
      }
      const payments = chosen.map((bill) => {
        const currency = currencyOf(bill.moneyAccountId);
        const typed = amounts[bill.id]?.trim();
        const index = chosen.filter((other) => other.moneyAccountId === bill.moneyAccountId).indexOf(bill);
        return {
          templateId: bill.id,
          billMonth: bill.billMonth,
          // Parsed here as it always was, so a figure that does not parse still says so.
          amountMinor: bill.amountMinor ?? (typed ? parseMajor(typed, currency) : 0),
          setAside: carried.get(bill.moneyAccountId)![index] ?? null,
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
    <Sheet grouped title="Pay several" onClose={onClose}>
      <InsetGroup>
        {ordered.map((bill) => (
          <BillTick
            key={bill.id}
            name={bill.name}
            status={pillOf(bill).text}
            checked={ticked.has(bill.id)}
            onToggle={() => toggle(bill.id)}
            amount={
              bill.amountMinor !== null ? (
                <Money minor={bill.amountMinor} currency={currencyOf(bill.moneyAccountId)} tone="none" />
              ) : (
                <input
                  className="ph-focus w-28 rounded bg-transparent text-right text-[17px] leading-[22px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] md:text-[15px] md:leading-[20px]"
                  inputMode="decimal"
                  aria-label={`What ${bill.name} came to`}
                  placeholder="Amount"
                  value={amounts[bill.id] ?? ''}
                  onChange={(e) => setAmounts((current) => ({ ...current, [bill.id]: e.target.value }))}
                />
              )
            }
          />
        ))}
      </InsetGroup>

      <InsetGroup>
        <TextRow label="Paid on" id="several-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </InsetGroup>

      {payers.map((payer) => (
        <PayerQuestion key={payer} accountId={payer} total={totalFrom(payer)} onChange={onAnswer} />
      ))}

      <ErrorBox error={error} />

      <InsetGroup>
        <InsetRow
          action
          title={ticked.size === 0 ? 'Record' : `Record ${ticked.size} ${ticked.size === 1 ? 'bill' : 'bills'}`}
          disabled={ticked.size === 0 || busy || !answered}
          onClick={() => void record()}
        />
      </InsetGroup>
    </Sheet>
  );
}

/**
 * One bill in the list: the statement's ring tick (an empty ring, an ink ring with a ✓ once picked — never filled), the
 * name with its status under it, and the amount at the right. The checkbox is the real control, laid invisibly over the ring.
 */
function BillTick({ name, status, checked, onToggle, amount, position }: GroupChild & { name: string; status: string; checked: boolean; onToggle: () => void; amount: ReactNode }) {
  return (
    <div className="relative">
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />}
      <div className="flex items-center gap-3" style={{ minHeight: rowHeight(true), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <label className="relative flex h-[44px] w-[32px] shrink-0 items-center justify-center">
          <input
            type="checkbox"
            className="peer ph-focus absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={`Pay ${name}`}
            checked={checked}
            onChange={onToggle}
          />
          <span
            aria-hidden
            className={cx(
              'flex h-[20px] w-[20px] items-center justify-center rounded-full border-[1.5px] border-[var(--ph-ink-3)] text-transparent',
              'peer-checked:border-[var(--ph-ink)] peer-checked:text-[var(--ph-ink)]',
            )}
          >
            <Check size={12} strokeWidth={3.5} aria-hidden />
          </span>
        </label>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] leading-[22px] font-medium text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]">{name}</span>
          <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{status}</span>
        </span>
        <span className="tabular shrink-0 whitespace-nowrap text-[17px] leading-[22px] text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]">{amount}</span>
      </div>
    </div>
  );
}
