import { expenseLines, formatMinor, formatUnits, isoDate, minorToMajorString, parseMajor } from '@expanses/core';
import { type AccountRow, type GoalPlanRow, moveSetAside, postTransaction, removeEarmark, retagTrade, saveEarmark, setStandingMonthly } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview, ratesForSave } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, ReadOnlyRow, SelectRow, TextRow } from '../../ui/native';
import { useHeldRates } from '../accounts/queries';
import { CategoryOptions } from '../cards/options';
import { useAssetProfiles, useTrades } from '../networth/queries';
import { type GoalEarmark, leftForGoal, lowered, monthlyAfter, monthlyPrefill, movablePurchases, moved, purchaseShare, setAsideFirst, setAsideOf, setAsideOn, STATUS_WORDS } from './goal-actions';
import { longDay } from './goal-cards';


/** A typed figure in a currency, or null while it is not one yet. */
function parsed(text: string, currency: string): number | null {
  if (text.trim() === '') return null;
  try {
    return parseMajor(text, currency);
  } catch {
    return null;
  }
}

/** Several currencies' figures on one line: "Rp 5.500.000 · US$100,00". */
const figures = (lines: { currency: string; amountMinor: number }[], base: string) =>
  lines.length === 0 ? formatMinor(0, base) : lines.map((line) => formatMinor(line.amountMinor, line.currency)).join(' · ');

/** A sheet's save: the error it ended in, whether it is under way, and the run itself (as the loan page's). */
function useSave(onDone: () => void) {
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function run(write: () => Promise<unknown>) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await write();
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return { run, error, busy };
}

/** This goal's set-asides with their account's name and money, in the order the earmarks came. */
function useGoalSetAsides(goalId: string, earmarks: readonly GoalEarmark[]) {
  const { ws } = useApp();
  const accounts = useAccounts().data ?? [];
  return setAsideOf(earmarks, goalId).map((earmark) => {
    const account = accounts.find((row) => row.id === earmark.accountId);
    return { ...earmark, name: account?.name ?? 'Account', currency: account?.currency ?? ws.baseCurrency };
  });
}

/**
 * Use: the goal's money spent on what it was for — the flight, the fee. An ordinary expense from the account, and the
 * goal's set-aside there lowered by as much as it held (the ledger's own spend answer). No stage is marked paid: that
 * is Mark paid's, behind the ⋯.
 */
export function UseSheet({ plan, earmarks, onClose }: { plan: GoalPlanRow; earmarks: readonly GoalEarmark[]; onClose: () => void }) {
  const { database, ws } = useApp();
  const accounts = useAccounts().data ?? [];
  const resolveRates = useResolveRates();
  const goalId = plan.goalId;
  const setAsides = useGoalSetAsides(goalId, earmarks);
  const payable = setAsideFirst(
    moneyHolders(accounts).filter((account) => SPENDABLE_SUBTYPES.includes(account.subtype) || setAsideOn(earmarks, goalId, account.id) > 0),
    earmarks,
    goalId,
  );
  const today = isoDate();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [fromId, setFromId] = useState(setAsides[0]?.accountId ?? payable[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);
  const [rateText, setRateText] = useState('');
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const saving = useSave(onClose);

  const from = accounts.find((account) => account.id === fromId);
  const currency = from?.currency ?? ws.baseCurrency;
  // The rate row, as the loan page draws it: only for money in another currency, and only while the day has no rate
  // stored, or a save found none to fetch.
  const foreign = currency !== ws.baseCurrency;
  const heldRates = useHeldRates(foreign ? [currency] : [], occurredOn);
  const askingRate = foreign && (needsRate === currency || (heldRates.data?.missing ?? []).includes(currency));
  const typed = parsed(amount, currency);
  const promised = setAsideOn(earmarks, goalId, fromId);
  const { takenMinor } = lowered(promised, typed);
  const left = leftForGoal(setAsides, fromId, takenMinor);

  const save = () =>
    saving.run(async () => {
      if (!from) throw new Error('Choose an account');
      if (!(typed !== null && typed > 0)) throw new Error('Enter an amount');
      if (!categoryId) throw new Error('Choose a category');
      const ratesToBase = await ratesForSave({ database, ws, currency, occurredOn, amountMinor: typed, typed: askingRate ? rateText : '', resolveRates, onMissing: setNeedsRate });
      await postTransaction(database, ws, {
        occurredOn,
        description: description.trim() || plan.goal.name,
        lines: expenseLines({ categoryAccountId: categoryId, paymentAccountId: from.id, amountMinor: typed, currency }),
        ratesToBase,
        // Only an account holding money for the goal has a set-aside to lower; any other pays as ordinary money.
        setAside: promised > 0 ? { accountId: from.id, goalId, intent: 'spend', overMinor: typed, stageId: null } : null,
      });
    });

  return (
    <Sheet
      grouped
      tall
      title={`Use for ${plan.goal.name}`}
      onClose={onClose}
      confirm={{ label: 'Save', disabled: saving.busy || !(typed !== null && typed > 0) || !categoryId || !from, run: () => void save() }}
    >
      <InsetGroup>
        <TextRow label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount" />
        <TextRow label="What for" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
        <SelectRow label="From" value={fromId} onChange={(e) => setFromId(e.target.value)}>
          {payable.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectRow>
        <SelectRow label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
        </SelectRow>
        <TextRow label="Date" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
        {askingRate && (
          <TextRow
            label={`Rate: ${ws.baseCurrency} per 1 ${currency}`}
            hint={ratePreview(rateText, currency, ws.baseCurrency) ?? `No ${currency} rate is stored for this day. Leave empty to fetch it.`}
            value={rateText}
            onChange={(e) => setRateText(e.target.value)}
            inputMode="decimal"
            placeholder="Rate"
          />
        )}
      </InsetGroup>
      <InsetGroup>
        <ReadOnlyRow label="Left for the goal" value={figures(left, ws.baseCurrency)} />
      </InsetGroup>
      <ErrorBox error={saving.error} />
    </Sheet>
  );
}

/** Monthly: what goes to the goal each month by standing arrangement. The amount is all a goal stores of it. */
export function MonthlySheet({ plan, onClose }: { plan: GoalPlanRow; onClose: () => void }) {
  const { database, ws } = useApp();
  const currency = ws.baseCurrency;
  const standing = plan.goal.standingMonthlyMinor;
  const [amount, setAmount] = useState(() => {
    const opening = monthlyPrefill(plan.requiredMonthlyMinor, plan.plannedMonthlyMinor, standing);
    return opening > 0 ? minorToMajorString(opening, currency) : '';
  });
  const saving = useSave(onClose);
  const typed = parsed(amount, currency);
  const after = monthlyAfter(plan.requiredMonthlyMinor, plan.plannedMonthlyMinor, standing, typed);
  const valid = amount.trim() === '' || (typed !== null && typed >= 0);

  const save = () => saving.run(() => setStandingMonthly(database, ws, plan.goalId, typed ?? 0));

  return (
    <Sheet grouped title={`Monthly for ${plan.goal.name}`} onClose={onClose} confirm={{ label: 'Save', disabled: saving.busy || !valid, run: () => void save() }}>
      <InsetGroup>
        <TextRow label="Each month" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount" />
      </InsetGroup>
      <InsetGroup>
        <ReadOnlyRow label="Needed a month" value={formatMinor(plan.requiredMonthlyMinor, currency)} />
        <ReadOnlyRow label="After this" value={`${formatMinor(after.plannedMonthlyMinor, currency)} · ${STATUS_WORDS[after.status]}`} />
      </InsetGroup>
      <ErrorBox error={saving.error} />
    </Sheet>
  );
}

/** Take back: money set aside for the goal goes back to being ordinary money in its account. Nothing is posted. */
export function TakeBackSheet({ plan, earmarks, onClose }: { plan: GoalPlanRow; earmarks: readonly GoalEarmark[]; onClose: () => void }) {
  const { database, ws } = useApp();
  const setAsides = useGoalSetAsides(plan.goalId, earmarks);
  const [fromId, setFromId] = useState(setAsides[0]?.accountId ?? '');
  const [amount, setAmount] = useState('');
  const saving = useSave(onClose);
  const source = setAsides.find((row) => row.accountId === fromId);
  const currency = source?.currency ?? ws.baseCurrency;
  const typed = parsed(amount, currency);
  const { takenMinor, leftMinor } = lowered(source?.amountMinor ?? 0, typed);
  const left = leftForGoal(setAsides, fromId, takenMinor);

  const save = () =>
    saving.run(async () => {
      if (!source || !(takenMinor > 0)) throw new Error('Enter an amount');
      if (leftMinor === 0) await removeEarmark(database, ws, plan.goalId, source.accountId);
      else await saveEarmark(database, ws, { goalId: plan.goalId, accountId: source.accountId, amountMinor: leftMinor });
    });

  return (
    <Sheet grouped title={`Take back from ${plan.goal.name}`} onClose={onClose} confirm={{ label: 'Save', disabled: saving.busy || !(takenMinor > 0), run: () => void save() }}>
      <InsetGroup>
        <TextRow label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount" />
        {setAsides.length > 1 && (
          <SelectRow label="From" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {setAsides.map((row) => (
              <option key={row.accountId} value={row.accountId}>
                {`${row.name} · set aside ${formatMinor(row.amountMinor, row.currency)}`}
              </option>
            ))}
          </SelectRow>
        )}
      </InsetGroup>
      <InsetGroup>
        <ReadOnlyRow label="Left for the goal" value={figures(left, ws.baseCurrency)} />
      </InsetGroup>
      <ErrorBox error={saving.error} />
    </Sheet>
  );
}

type MoveSource =
  | { key: string; kind: 'set-aside'; accountId: string; label: string; amountMinor: number; currency: string; baseRate: number | null }
  | { key: string; kind: 'purchase'; tradeId: string; label: string; baseMinor: number };

/**
 * Move: money set aside on an account, or a tagged purchase, handed to another goal. A set-aside stays on its account
 * and only changes goal; a purchase moves whole, since a tag sits on a whole trade. Nothing is posted.
 */
export function MoveSheet({ plan, others, earmarks, onClose }: { plan: GoalPlanRow; others: readonly GoalPlanRow[]; earmarks: readonly GoalEarmark[]; onClose: () => void }) {
  const { database, ws } = useApp();
  const setAsides = useGoalSetAsides(plan.goalId, earmarks);
  const trades = useTrades().data ?? [];
  const profiles = useAssetProfiles().data ?? [];
  const accounts: readonly AccountRow[] = useAccounts().data ?? [];
  const nameOf = (accountId: string) => accounts.find((row) => row.id === accountId)?.name ?? 'Holding';
  const unitOf = (accountId: string) => {
    const kind = profiles.find((row) => row.accountId === accountId)?.unitKind;
    return kind === 'grams' ? 'g' : kind === 'shares' ? 'shares' : 'units';
  };

  const sources: MoveSource[] = [
    ...setAsides.map((row): MoveSource => {
      const link = plan.links.find((item) => item.kind === 'earmark' && item.accountId === row.accountId);
      const baseRate = row.currency === ws.baseCurrency ? 1 : link && link.baseMinor !== null && link.valueMinor > 0 ? link.baseMinor / link.valueMinor : null;
      return {
        key: `set-aside-${row.accountId}`,
        kind: 'set-aside',
        accountId: row.accountId,
        label: `${row.name} · set aside ${formatMinor(row.amountMinor, row.currency)}`,
        amountMinor: row.amountMinor,
        currency: row.currency,
        baseRate,
      };
    }),
    ...movablePurchases(trades, plan.goalId).map((trade): MoveSource => {
        const link = plan.links.find((item) => item.kind === 'tagged' && item.accountId === trade.accountId);
        return {
          key: `purchase-${trade.id}`,
          kind: 'purchase',
          tradeId: trade.id,
          label: `${nameOf(trade.accountId)} · bought ${longDay(trade.occurredOn)} · ${formatUnits(trade.unitsMicro)} ${unitOf(trade.accountId)}`,
          baseMinor: link ? purchaseShare(trade.unitsMicro, link.unitsMicro ?? 0, link.baseMinor ?? 0) : 0,
        };
      }),
  ];

  const [sourceKey, setSourceKey] = useState(sources[0]?.key ?? '');
  const [toId, setToId] = useState(others[0]?.goalId ?? '');
  const [amount, setAmount] = useState('');
  const saving = useSave(onClose);
  const source = sources.find((row) => row.key === sourceKey) ?? sources[0];
  const target = others.find((row) => row.goalId === toId);
  const currency = source?.kind === 'set-aside' ? source.currency : ws.baseCurrency;
  const typed = parsed(amount, currency);

  const targetHeld = source?.kind === 'set-aside' ? setAsideOn(earmarks, toId, source.accountId) : 0;
  const move = source?.kind === 'set-aside' ? moved(source.amountMinor, targetHeld, typed) : null;
  const movedBase = !source ? 0 : source.kind === 'purchase' ? source.baseMinor : Math.round((move?.movedMinor ?? 0) * (source.baseRate ?? 0));
  const ready = !!source && !!target && (source.kind === 'purchase' || (move?.movedMinor ?? 0) > 0);

  const save = () =>
    saving.run(async () => {
      if (!source || !target) throw new Error('Choose a goal');
      if (source.kind === 'purchase') await retagTrade(database, ws, source.tradeId, target.goalId);
      else await moveSetAside(database, ws, { fromGoalId: plan.goalId, toGoalId: target.goalId, accountId: source.accountId, amountMinor: move?.movedMinor ?? 0 });
    });

  return (
    <Sheet grouped title={`Move from ${plan.goal.name}`} onClose={onClose} confirm={{ label: 'Move', disabled: saving.busy || !ready, run: () => void save() }}>
      <InsetGroup>
        {sources.length > 1 && (
          <SelectRow label="From" value={source?.key ?? ''} onChange={(e) => setSourceKey(e.target.value)}>
            {sources.map((row) => (
              <option key={row.key} value={row.key}>
                {row.label}
              </option>
            ))}
          </SelectRow>
        )}
        {source?.kind === 'set-aside' && (
          <TextRow label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount" />
        )}
        <SelectRow label="To goal" value={toId} onChange={(e) => setToId(e.target.value)}>
          {others.map((row) => (
            <option key={row.goalId} value={row.goalId}>
              {row.goal.name}
            </option>
          ))}
        </SelectRow>
      </InsetGroup>
      <InsetGroup>
        <ReadOnlyRow label={`${plan.goal.name} after`} value={formatMinor(Math.max(0, plan.currentMinor - movedBase), ws.baseCurrency)} />
        {target && <ReadOnlyRow label={`${target.goal.name} after`} value={formatMinor(target.currentMinor + movedBase, ws.baseCurrency)} />}
      </InsetGroup>
      <ErrorBox error={saving.error} />
    </Sheet>
  );
}

/** Whether the goal has a tagged purchase to move, read the way the Move sheet reads it. */
export function useHasTaggedPurchase(goalId: string): boolean {
  const trades = useTrades().data ?? [];
  return movablePurchases(trades, goalId).length > 0;
}
