import { groupTypedAmount, parseGroupedMajor } from '@expanses/core';
import { type MonthlyBill, recordBillPayments, type SetAsideChoice } from '@expanses/db';
import { type ReactNode, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { useCards } from '../cards/card-queries';
import { Check } from 'lucide-react';
import { cx, ErrorBox, Money } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, PickerRow, ROW_PAD_X, ROW_PAD_Y, rowHeight, SelectCircle, SwitchRow, TextRow } from '../../ui/native';
import { payerChoices, spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { payerPlan } from './bill-payer';
import { pillOf } from './bill-view';
import { chargedEstimateText, useChargedRates } from './charged';
import { useSinkingFunds } from './queries';

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
function PayerQuestion({ accountId, total, ownGoalIds, onChange }: { accountId: string; total: number; ownGoalIds: string[]; onChange: (accountId: string, answer: PayerAnswer) => void }) {
  const door = spendingDoor(accountId, total);
  // A bill paid out of its own fund's account has the fund's money as room: it is what was set aside for exactly this.
  const setAside = useSetAside(door && ownGoalIds.length > 0 ? { ...door, ownGoalId: ownGoalIds } : door);
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
  /** Every unsettled bill this month; the sheet lists only the picked ones among them. */
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
  const funds = useSinkingFunds(today).data ?? [];
  const cards = useCards().data ?? [];
  const balances = useBalances().data ?? {};
  // The same list the single Pay sheet offers: money kept for spending, and the cards switched on for it.
  const wallets = moneyHolders(accounts).filter((account) => canPayWith(account));
  // The one account every ticked bill is paid with, or null for each bill's own.
  const [override, setOverride] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const overrideAccount = override ? accounts.find((account) => account.id === override) : undefined;
  const planOf = (bill: MonthlyBill) => payerPlan(bill, accounts, overrideAccount ? override : null, ws.baseCurrency);
  /** The money a bill is written in: its own, else its paying account's. A foreign one is charged in the account's. */
  const billCurrency = (bill: MonthlyBill) => planOf(bill).billCurrency;
  const payerOf = (bill: MonthlyBill) => planOf(bill).payerId;
  const payerCurrencyOf = (bill: MonthlyBill) => planOf(bill).payerCurrency;
  const isForeign = (bill: MonthlyBill) => planOf(bill).foreign;

  // Only what was picked on the list: a bill that was not selected has no place on this sheet.
  const ordered = bills.filter((bill) => picked.has(bill.id));

  const [ticked, setTicked] = useState<Set<string>>(() => new Set(picked));
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // What each foreign bill's account was charged, once typed; a bill not in here still shows its estimate.
  const [charges, setCharges] = useState<Record<string, string>>({});
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, PayerAnswer>>({});

  const chosen = bills.filter((bill) => ticked.has(bill.id));
  /** The figure each bill posts: the fixed amount, or what was typed for one that varies (0 until it parses). */
  const amountOf = (bill: MonthlyBill) => {
    if (bill.amountMinor !== null) return bill.amountMinor;
    try {
      return parseGroupedMajor(amounts[bill.id]?.trim() ?? '', billCurrency(bill));
    } catch {
      return 0;
    }
  };
  const foreignChosen = chosen.filter(isForeign);
  const rates = useChargedRates(
    foreignChosen.flatMap((bill) => [billCurrency(bill), payerCurrencyOf(bill)]),
    paidOn,
  );
  const estimateOf = (bill: MonthlyBill) =>
    chargedEstimateText({ amountMinor: amountOf(bill), billCurrency: billCurrency(bill), payerCurrency: payerCurrencyOf(bill), rates, baseCurrency: ws.baseCurrency });
  const chargeShown = (bill: MonthlyBill) => charges[bill.id] ?? estimateOf(bill);
  /** What the account is charged, in its own money (0 until it parses). */
  const chargedOf = (bill: MonthlyBill) => {
    try {
      const text = chargeShown(bill).trim();
      return text ? parseGroupedMajor(text, payerCurrencyOf(bill)) : 0;
    } catch {
      return 0;
    }
  };
  /** What leaves the paying account: the charge for a foreign bill, else the bill's own figure. */
  const takenOf = (bill: MonthlyBill) => (isForeign(bill) ? chargedOf(bill) : amountOf(bill));
  const refusals = chosen.map((bill) => planOf(bill).refusal).filter((text): text is string => text !== null);
  // On a credit card, a bill that was saving up can also pay the card from the fund's account (as on the single Pay sheet).
  const [fromFund, setFromFund] = useState(true);
  const fundOf = (bill: MonthlyBill) => funds.find((fund) => fund.billId === bill.id) ?? null;
  const cardFromFund = (bill: MonthlyBill) => {
    const fund = fundOf(bill);
    const payer = accounts.find((account) => account.id === payerOf(bill));
    return !!fund && payer?.kind === 'liability' && payer.id !== fund.accountId && payerCurrencyOf(bill) === fund.currency;
  };
  const anyCardFromFund = chosen.some(cardFromFund);
  const payFromFund = (bill: MonthlyBill) => cardFromFund(bill) && fromFund;
  /** The account the money leaves: the fund's when it pays the card, else the payer's. */
  const spenderOf = (bill: MonthlyBill) => (payFromFund(bill) ? fundOf(bill)!.accountId : payerOf(bill));
  const payers = [...new Set(chosen.map(spenderOf))];
  const billsFrom = (payer: string) => chosen.filter((bill) => spenderOf(bill) === payer);
  const totalFrom = (payer: string) => billsFrom(payer).reduce((sum, bill) => sum + takenOf(bill), 0);
  const ownGoalsFrom = (payer: string) => billsFrom(payer).filter((bill) => fundOf(bill)?.accountId === payer).map((bill) => bill.id);
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
    if (!answered || refusals.length > 0) return;
    setError(null);
    setBusy(true);
    try {
      // Each account's answer, laid over its payments in order: a borrow is what went over the free money, spread; a
      // spend is the whole of each payment up to the promise, as one payment of the same total would be.
      const carried = new Map<string, (SetAsideChoice | null)[]>();
      for (const payer of payers) {
        const answer = answers[payer];
        const mine = billsFrom(payer);
        carried.set(payer, payerChoices(answer?.choice ?? null, mine.map(takenOf), answer?.freeMinor ?? null, answer?.promisedMinor ?? 0));
      }
      const payments = chosen.map((bill) => {
        const currency = billCurrency(bill);
        const typed = amounts[bill.id]?.trim();
        const index = billsFrom(spenderOf(bill)).indexOf(bill);
        return {
          templateId: bill.id,
          billMonth: bill.billMonth,
          // Parsed here as it always was, so a figure that does not parse still says so.
          amountMinor: bill.amountMinor ?? (typed ? parseGroupedMajor(typed, currency) : 0),
          chargedMinor: isForeign(bill) ? chargedOf(bill) : undefined,
          // Named only when the sheet chose the account; otherwise the bill's own pays, as it always did.
          ...(overrideAccount ? { moneyAccountId: overrideAccount.id } : {}),
          setAside: carried.get(spenderOf(bill))![index] ?? null,
          payCardFromFund: payFromFund(bill),
        };
      });
      if (payments.some((payment) => !(payment.amountMinor > 0))) {
        setError('Enter the amount of each ticked bill that varies');
        return;
      }
      const unpriced = chosen.find((bill) => isForeign(bill) && !(chargedOf(bill) > 0));
      if (unpriced) {
        setError(`Enter what the account was charged in ${payerCurrencyOf(unpriced)} for ${unpriced.name}`);
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
                <Money minor={bill.amountMinor} currency={billCurrency(bill)} tone="none" />
              ) : (
                <input
                  className="ph-focus w-28 rounded bg-transparent text-right text-[17px] leading-[22px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] md:text-[15px] md:leading-[20px]"
                  inputMode="decimal"
                  aria-label={`What ${bill.name} came to`}
                  placeholder="Amount"
                  value={amounts[bill.id] ?? ''}
                  onChange={(e) => setAmounts((current) => ({ ...current, [bill.id]: groupTypedAmount(e.target.value, billCurrency(bill)) }))}
                />
              )
            }
          />
        ))}
      </InsetGroup>

      <InsetGroup>
        <PickerRow label="Payment method" testId="several-with" value={overrideAccount?.name ?? "Each bill's own account"} onOpen={() => setPicking(true)} />
        {anyCardFromFund && <SwitchRow label="Pay the card from the fund" checked={fromFund} onChange={setFromFund} info="Moves the same amount from the fund's account to the card, and lets the fund go." />}
        <TextRow label="Paid on" id="several-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </InsetGroup>

      {foreignChosen.length > 0 && (
        <InsetGroup header="Charged" info="What each account was charged, as its statement shows. It starts as an estimate at the latest rate known, and can be changed to the real figure.">
          {foreignChosen.map((bill) => (
            <TextRow
              key={bill.id}
              label={`${bill.name} in ${payerCurrencyOf(bill)}`}
              inputMode="decimal"
              aria-label={`Charged in ${payerCurrencyOf(bill)} for ${bill.name}`}
              value={chargeShown(bill)}
              onChange={(e) => setCharges((current) => ({ ...current, [bill.id]: groupTypedAmount(e.target.value, payerCurrencyOf(bill)) }))}
              placeholder="Charged"
            />
          ))}
        </InsetGroup>
      )}

      {payers.map((payer) => (
        <PayerQuestion key={payer} accountId={payer} total={totalFrom(payer)} ownGoalIds={ownGoalsFrom(payer)} onChange={onAnswer} />
      ))}

      {refusals.map((text) => (
        <p key={text} role="alert" className="pb-3 text-center text-sm text-[var(--ph-alarm)]">
          {text}
        </p>
      ))}
      <ErrorBox error={error} />

      <InsetGroup>
        <InsetRow
          action
          title={ticked.size === 0 ? 'Record' : `Record ${ticked.size} ${ticked.size === 1 ? 'bill' : 'bills'}`}
          disabled={ticked.size === 0 || busy || !answered || refusals.length > 0}
          onClick={() => void record()}
        />
      </InsetGroup>

      {picking && (
        <PaidWithSheet
          wallets={wallets}
          chosen={overrideAccount?.id ?? null}
          balances={balances}
          digits={Object.fromEntries(cards.filter((card) => card.last4).map((card) => [card.accountId, card.last4!]))}
          onPick={(id) => {
            setOverride(id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </Sheet>
  );
}

/** The accounts and cards that can pay, as the single Pay sheet lists them; the first row leaves each bill with its own. */
function PaidWithSheet({
  wallets,
  chosen,
  balances,
  digits,
  onPick,
  onClose,
}: {
  wallets: { id: string; name: string; kind: string; currency: string | null }[];
  chosen: string | null;
  balances: Record<string, number>;
  digits: Record<string, string>;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const { ws } = useApp();
  const tick = <Check size={18} aria-hidden />;
  const spendable = wallets.filter((account) => account.kind === 'asset');
  const cards = wallets.filter((account) => account.kind !== 'asset');
  return (
    <Sheet grouped title="Payment method" onClose={onClose}>
      <InsetGroup>
        <InsetRow title="Each bill's own account" subtitle="Keeps what each bill says" value={chosen === null ? tick : undefined} onClick={() => onPick(null)} testId="paid-with-own" />
      </InsetGroup>
      {spendable.length > 0 && (
        <InsetGroup header="Accounts">
          {spendable.map((account) => (
            <InsetRow
              key={account.id}
              title={account.name}
              value={
                <span className="flex items-center gap-2">
                  <Money minor={balances[account.id] ?? 0} currency={account.currency ?? ws.baseCurrency} tone="none" />
                  {chosen === account.id && tick}
                </span>
              }
              onClick={() => onPick(account.id)}
            />
          ))}
        </InsetGroup>
      )}
      {cards.length > 0 && (
        <InsetGroup header="Credit cards">
          {cards.map((account) => (
            <InsetRow
              key={account.id}
              title={account.name}
              value={
                <span className="flex items-center gap-2">
                  {digits[account.id] ? `···· ${digits[account.id]}` : null}
                  {chosen === account.id && tick}
                </span>
              }
              onClick={() => onPick(account.id)}
            />
          ))}
        </InsetGroup>
      )}
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
          <SelectCircle picked={checked} />
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
