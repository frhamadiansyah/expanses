import { formatMinor, installmentSplit, minorToMajorString, parseMajor, purchasesForPlastic, transferLines } from '@expanses/core';
import type { SpendLine } from '@expanses/core';
import { type AccountRow, cardStatement, type CardRow, postTransaction, spendByPlastic } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Banknote, Gift, ReceiptText } from 'lucide-react';
import { useSearch } from '@tanstack/react-router';
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { keptForSpending } from '../../lib/account-types';
import { moneyHolders, useCategoryColours, useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { createPortal } from 'react-dom';
import { ActionButtons, PageDots, InsetGroup, InsetRow, type InsetRowProps, SelectRow, TextRow, useSwipeStep, useWalletSlot } from '../../ui/native';
import { backRadius } from '../accounts/balance-back';
import { BackSlot } from './CardBack';
import { useSpendBonuses } from './spend-bonuses';
import { useFeeWaivedStatus, waivedLine } from './fee-waived-status';
import { challengeCoversFee } from './fee-line';
import { categoryMark } from '../categories/CategoryIcon';
import { CardFace } from './CardFace';
import { cycleBack, dueDateAfter, dueIn } from './statement-dates';
import { cardBackFigure, limitUsage } from './limit-usage';
import { useCardLines, useInstallments } from '../loans/queries';
import { spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { type CardPoints, formatPoints, shortDate } from './useCardPoints';
import { useOpenFromSearch } from '../../lib/open-once';

/**
 * Wallet's "Latest Transactions" under an open pass: the card's most recent purchases, each opening its receipt, and
 * a last row that opens the whole statement — or, for a debit card, every transaction of its account.
 */
function LatestTransactions({
  cardAccountId,
  today,
  lines,
  accounts,
  currency,
  pointsOf,
  unit,
  seeAll,
}: {
  /** The card account, whose instalment rows (option C) are listed with its purchases on their statement day. */
  cardAccountId?: string;
  today?: string;
  lines: readonly SpendLine[];
  accounts: readonly AccountRow[];
  currency: string;
  /** What a purchase earned, or null when there is nothing to say: no rewards, or a purchase the rules never read. */
  pointsOf: (transactionId: string) => number | null;
  unit: string;
  /** Where See all goes. */
  seeAll: Pick<InsetRowProps, 'to' | 'params' | 'search'>;
}) {
  const chosen = useCategoryColours().data;
  // One row per purchase, however many lines its split made, newest first.
  const purchases = new Map<string, { id: string; on: string; description: string; categoryId: string; amountMinor: number; plan?: { planId: string; number: number; of: number } }>();
  for (const line of lines) {
    const seen = purchases.get(line.transactionId);
    if (seen) seen.amountMinor += line.amountMinor;
    else purchases.set(line.transactionId, { id: line.transactionId, on: line.occurredOn, description: line.description, categoryId: line.categoryId, amountMinor: line.amountMinor });
  }
  // Each month's instalment of a plan is a row of the card's on its statement day, from the oldest purchase shown up to
  // today: worked out from the plan, it opens the plan rather than a receipt.
  const billed = useCardLines(cardAccountId ?? '', !!cardAccountId);
  const since = [...purchases.values()].reduce((first, purchase) => (purchase.on < first ? purchase.on : first), today ?? '9999-12-31');
  for (const line of billed.data ?? []) {
    if (!line.instalment || !today || line.statementOn > today || line.statementOn < since) continue;
    purchases.set(line.key, {
      id: line.key,
      on: line.statementOn,
      description: line.description,
      categoryId: line.instalment.categoryId ?? '',
      amountMinor: line.owedMinor,
      plan: { planId: line.instalment.planId, number: line.instalment.number, of: line.instalment.of },
    });
  }
  const latest = [...purchases.values()].sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0)).slice(0, 5);
  return (
    <section data-testid="latest-transactions" className="mt-[8px]">
      <InsetGroup header="Recent">
        {latest.length === 0 && <InsetRow title="No purchases this cycle" subtitle="What this card pays for shows here." />}
        {latest.map((purchase) => {
          const mark = categoryMark(purchase.categoryId, accounts, chosen);
          const earned = pointsOf(purchase.id);
          return (
            <InsetRow
              key={purchase.id}
              icon={<mark.Glyph size={16} strokeWidth={2.2} />}
              iconColour={mark.colour}
              // The category is the first line, as on Cashflow; the note and the day are the second; the points sit under the amount.
              title={mark.name || purchase.description || 'Purchase'}
              subtitle={[purchase.description, purchase.plan ? `${purchase.plan.number} of ${purchase.plan.of}` : null, shortDate(purchase.on)].filter(Boolean).join(' · ')}
              value={
                <span className="flex flex-col items-end">
                  <span>{formatMinor(purchase.amountMinor, currency)}</span>
                  {earned ? <span className="text-[12.5px] leading-[16px] font-normal text-[var(--ph-ink-3)]">{`${earned < 0 ? '−' : '+'}${formatPoints(Math.abs(earned))} ${unit}`}</span> : null}
                </span>
              }
              valueTone="ink"
              {...(purchase.plan && cardAccountId
                ? { to: '/cards/$cardId/settings/instalments/$planId' as const, params: { cardId: cardAccountId, planId: purchase.plan.planId } }
                : { to: '/transactions/$transactionId' as const, params: { transactionId: purchase.id } })}
            />
          );
        })}
        <InsetRow title={<span className="text-[var(--ph-tint)]">See all</span>} {...seeAll} />
      </InsetGroup>
    </section>
  );
}

/** Pays the card in full or in part from a bank account, in a sheet: one transfer, the same as recording it by hand. */
function PaySheet({ card, accounts, amountMinor, today, onDone }: { card: AccountRow; accounts: readonly AccountRow[]; amountMinor: number; today: string; onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const currency = card.currency ?? ws.baseCurrency;
  // Only money that can pay a bill and is kept for spending: not holdings such as gold or shares, not savings put aside.
  const payers = moneyHolders(accounts).filter((a) => keptForSpending(a) && a.currency === currency);
  const [fromId, setFromId] = useState(payers[0]?.id ?? '');
  const [amount, setAmount] = useState(minorToMajorString(amountMinor, currency));
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // The figure `pay()` posts, read by the same parser at render so the question measures what will leave.
  const minorTyped = (() => {
    try {
      return parseMajor(amount, currency);
    } catch {
      return 0;
    }
  })();
  const setAside = useSetAside(spendingDoor(fromId, minorTyped));

  async function pay() {
    // The hidden submit answers Enter: the question is a condition on it too.
    if (!setAside.ready) return;
    setError(null);
    setBusy(true);
    try {
      const minor = parseMajor(amount, currency);
      if (!(minor > 0)) throw new Error('Enter the amount paid');
      if (!fromId) throw new Error(`Add a ${currency} bank account to pay the card from`);
      await postTransaction(database, ws, { occurredOn: paidOn, description: `${card.name} payment`, lines: transferLines({ fromAccountId: fromId, toAccountId: card.id, amountMinor: minor, currency }), setAside: setAside.choice, fileTransfer: true });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    }finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title={`Pay ${card.name}`} onClose={onDone}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void pay();
        }}
      >
        <InsetGroup>
          <TextRow label="Amount" prefix={currency} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
          <SelectRow label="Paid with" value={fromId} onChange={(event) => setFromId(event.target.value)}>
            {payers.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectRow>
          <TextRow label="Paid on" type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
        </InsetGroup>
        {setAside.node}
        <ErrorBox error={error} />
        {/* Hidden, so Enter in any field still records the payment; the Record row is the one the reader sees and taps. */}
        <input type="submit" hidden disabled={busy || !setAside.ready} />
        <InsetGroup>
          <InsetRow title="Record payment" onClick={() => void pay()} disabled={busy || !setAside.ready} action />
        </InsetGroup>
      </form>
    </Sheet>
  );
}

/**
 * A card's page: its summary, which is the whole page now that its sections are pages of their own.
 *
 * Opened from the Wallet stack: what is owed, the round actions, the instalments and the
 * latest purchases. Opened on its own (an account the stack does not hold): layout D2 — the card with how much of the
 * limit is used, then the current bill and the points as equals.
 *
 * On a wide screen the art keeps its column beside the tiles rather than the tiles being stretched across it.
 */
export function CardHero({
  cp,
  accounts,
  plastic,
  issuer,
  owedMinor,
  creditMinor = 0,
  debit = false,
  pointsBalance,
  today,
  setup,
  instalments,
  lines = [],
}: {
  cp: CardPoints;
  accounts: readonly AccountRow[];
  plastic: readonly CardRow[];
  issuer: string | null;
  owedMinor: number;
  /** What the card was paid past what it owed — money the bank holds for you. Unpaid stays at nothing beside it. */
  creditMinor?: number;
  /** A debit card spends money the account already holds: nothing is owed, nothing is due, nothing to pay. */
  debit?: boolean;
  pointsBalance: { total: number; posted: number; estimated: number } | null;
  today: string;
  /** The step a card still being set up is at, opening its Settings: under the round actions. */
  setup?: ReactNode;
  /** The card's instalment plans, with the way to add and remove them: under this statement's points. */
  instalments?: ReactNode;
  /** The purchases the page has read for this card, newest cycle first: the latest of them are the summary's list. */
  lines?: readonly SpendLine[];
}) {
  const { database, ws } = useApp();
  const card = cp.card;
  const currency = card.currency ?? ws.baseCurrency;
  const [paying, setPaying] = useState(false);
  // The Debt-free plan's Pay lands here with `?pay=1`: the pay sheet opens once, and closing it goes back.
  const { pay } = useSearch({ strict: false }) as { pay?: true };
  const fromLink = useOpenFromSearch(pay === true, () => setPaying(true), !debit);
  const cards = [...plastic].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const [shownIndex, setShownIndex] = useState(0);
  const [showHeld, setShowHeld] = useState(false);
  const shown = cards[Math.min(shownIndex, Math.max(0, cards.length - 1))];
  /*
   * Opened from the Wallet stack, the card is the stack's own element, raised over this spot at the width it had
   * in the stack: the hero leaves it a slot of that size and draws no card of its own. The dots still choose which
   * plastic card it shows.
   */
  const slot = useWalletSlot();
  const setSlotShown = slot?.setShown;
  // The card turns over to its back: Outstanding (or Credit), the limit, and the nearest bonus or the points.
  const setFlippable = slot?.setFlippable;
  useEffect(() => {
    setFlippable?.(true);
    return () => setFlippable?.(false);
  }, [setFlippable]);
  // What each plastic card spent this statement, said on its own face: only a credit card with several plastics.
  const spendCycle = cp.current?.cycle ?? (cp.terms ? cycleBack(today, cp.terms.statementDay, 0) : null);
  const several = !debit && cards.length > 1 && spendCycle !== null;
  const byPlastic = useQuery({
    queryKey: ['spend-by-plastic', ws.workspaceId, card.id, spendCycle?.start ?? '-', spendCycle?.end ?? '-', today],
    enabled: several,
    queryFn: () => spendByPlastic(database, ws, card.id, spendCycle!.start, spendCycle!.end),
  });
  // A purchase that names no card belongs to the primary.
  const spentText =
    several && shown && byPlastic.data ? formatMinor((byPlastic.data[shown.id] ?? 0) + (shown.isPrimary ? (byPlastic.data[''] ?? 0) : 0), currency) : null;
  useEffect(() => {
    setSlotShown?.(shown ? { last4: shown.last4, holderName: shown.holderName, spent: spentText } : null);
  }, [setSlotShown, shown?.last4, shown?.holderName, spentText]);
  // A swipe on the card steps through the plastic cards, as the dots do. It answers whether there was one to step to.
  const lastIndex = cards.length - 1;
  const stepShown = useCallback(
    (by: 1 | -1): boolean => {
      const next = shownIndex + by;
      if (next < 0 || next > lastIndex) return false;
      setShownIndex(next);
      return true;
    },
    [shownIndex, lastIndex],
  );
  const setSlotSwipe = slot?.setSwipe;
  useEffect(() => {
    if (!setSlotSwipe || lastIndex < 1) return;
    setSlotSwipe(stepShown);
    return () => setSlotSwipe(null);
  }, [setSlotSwipe, stepShown, lastIndex]);
  const faceBox = useRef<HTMLDivElement>(null);
  const faceSwipe = useSwipeStep({ enabled: lastIndex >= 1, onStep: stepShown, target: () => faceBox.current });
  const limit = cp.limitMinor;
  const plans = useInstallments(card.id);
  const holding = (plans.data ?? []).map((plan) => ({ plan, split: installmentSplit(plan, today) })).filter(({ split }) => split.unbilledMinor > 0);
  // A credit is what the bank holds past the bill: it adds to what can be spent, so the limit is read from the signed balance.
  const usage = limitUsage(owedMinor - creditMinor, limit, holding.reduce((sum, { split }) => sum + split.unbilledMinor, 0));

  const lastCycle = cp.terms ? cycleBack(today, cp.terms.statementDay, 1) : null;
  const last = useQuery({
    queryKey: ['card-statement', ws.workspaceId, card.id, lastCycle?.start ?? '-', today],
    enabled: lastCycle !== null,
    queryFn: () => cardStatement(database, ws, card.id, lastCycle!, today),
  });

  // The balance is the programme's the card earns into, counted in that programme's unit.
  const unit = cp.programme?.unit ?? cp.program?.unit ?? 'points';
  const unitLabel = unit === 'miles' ? 'Miles' : unit === 'cashback' ? 'Cashback' : 'Points';
  // The spend bonuses (cycle bonuses and the fee waiver), nearest to their goal first: the back shows the first.
  const bonuses = useSpendBonuses(cp, accounts, today);
  // A fee challenge met and its fee waived says so on the back, with what came back.
  const feeStatus = useFeeWaivedStatus(card.id, today);
  /** What one purchase earned, by this cycle's or the last one's rules; nothing when the card earns nothing. */
  const pointsOf = (transactionId: string): number | null =>
    cp.program ? (cp.current?.earn.pointsByTransaction[transactionId] ?? cp.previous?.earn.pointsByTransaction[transactionId] ?? null) : null;
  // Where the summary leads: the card's own pages, and the programme its points go into.
  const params = { cardId: card.id };
  const toSettings = { to: '/cards/$cardId/settings' as const, params };
  const toPoints = { to: '/cards/$cardId/points' as const, params };
  const toStatement = { to: '/cards/$cardId/statement' as const, params };
  // A debit card has no statement: its See all is every transaction of the account it spends from.
  const seeAll = debit ? { to: '/transactions' as const, search: { account: card.id } } : toStatement;
  // Recent follows the plastic card shown; a purchase naming no card, or a removed one, is the primary's.
  const recentLines = purchasesForPlastic(lines, cards, shown?.id);
  const recent = (
    <LatestTransactions cardAccountId={debit ? undefined : card.id} today={today} lines={recentLines} accounts={accounts} currency={currency} pointsOf={pointsOf} unit={unit} seeAll={seeAll} />
  );

  const dueOn = lastCycle && cp.terms ? dueDateAfter(lastCycle.end, cp.terms.dueDay) : null;
  // The statement already bills instalment plans a month at a time, so this is what the bank asks for.
  const leftToPayMinor = last.data?.leftToPayMinor ?? 0;
  const owing = leftToPayMinor > 0;
  const due = dueOn ? dueIn(today, dueOn) : null;

  /** What sits under the bill's figure: when it is due, that it is paid, or that nothing was billed. */
  const billCaption = (): ReactNode => {
    if (!cp.terms || !lastCycle) return 'Add the billing date to see statements.';
    if (!last.data || last.data.closingMinor <= 0) return `Nothing billed on ${shortDate(lastCycle.end)}`;
    if (!owing || !dueOn || !due) return `Paid in full · statement of ${shortDate(lastCycle.end)}`;
    return (
      <>
        <span data-testid="due-date">
          Due {shortDate(dueOn)} ·{' '}
          <span className={cx(due.tone === 'late' && 'font-semibold text-[var(--ph-alarm)]', due.tone === 'soon' && 'font-semibold text-[var(--ph-warn)]')}>
            {due.text}
          </span>
        </span>
        {` · statement of ${shortDate(lastCycle.end)}`}
      </>
    );
  };

  /**
   * The limit bar and the lines under it. Compact on Wallet's summary: the instalments are a group of their own
   * there, so the bar is read by what is left — "Rp29.300.000 available of Rp50.000.000" — and nothing more.
   */
  const limitBlock = (compact = false) => (
    <>
        {/*
         * The limit bar. Two fills, not one: what is owed outright, and the part of it an instalment plan has not
         * billed yet — which is why `ProgressBar` cannot draw it. The tokens are the kit's all the same.
         */}
        {usage.usedPct !== null && (
          <div className="mt-2 flex h-[7px] overflow-hidden rounded-full bg-[var(--ph-track)]" data-testid="limit-bar">
            <div
              className="h-full"
              style={{ width: `${usage.barUsedPct}%`, background: (usage.usedPct ?? 0) >= 80 ? 'var(--ph-warn)' : 'var(--ph-up)' }}
            />
            {usage.barHeldPct > 0 && (
              <div
                className="h-full"
                title="Held by instalments"
                style={{ width: `${usage.barHeldPct}%`, backgroundImage: 'repeating-linear-gradient(135deg, var(--ph-ink-2) 0 3px, var(--ph-ink-3) 3px 6px)' }}
              />
            )}
          </div>
        )}
        {!debit && !compact && (
          <div className="mt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="card-owed">
            Used {formatMinor(usage.usedMinor, currency)}
            {usage.usedPct !== null ? ` · ${usage.usedPct}%` : ''}
          </div>
        )}
        {usage.heldMinor > 0 && !compact && (
          <div
            className="relative text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]"
            data-testid="card-instalments-held"
            onMouseEnter={() => setShowHeld(true)}
            onMouseLeave={() => setShowHeld(false)}
            onFocus={() => setShowHeld(true)}
            onBlur={() => setShowHeld(false)}
          >
            <span tabIndex={0} aria-describedby={showHeld ? 'held-by-plans' : undefined} className="ph-focus cursor-help underline decoration-dotted underline-offset-2">
              Instalments hold {formatMinor(usage.heldMinor, currency)}
            </span>
            {/* Each plan and what it still holds, on hover or keyboard focus. */}
            {showHeld && (
              <div id="held-by-plans" role="tooltip" className="absolute top-full left-0 z-20 mt-1 w-80 rounded-[11px] bg-[var(--ph-ink)] p-2.5 text-xs text-[var(--ph-surface)] shadow-lg">
                {holding.map(({ plan, split }) => (
                  <div key={plan.id} className="flex justify-between gap-3 py-0.5">
                    <span className="min-w-0">{plan.description}</span>
                    <span className="shrink-0 tabular opacity-70">
                      {formatMinor(split.unbilledMinor, currency)} · {split.monthsLeft} of {plan.months} left
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {usage.availableMinor !== null && limit !== null && (
          <div
            className={cx('text-[12.5px] leading-[16px]', compact && 'mt-[6px]', usage.availableMinor < 0 ? 'font-medium text-[var(--ph-alarm)]' : 'text-[var(--ph-ink-3)]')}
            data-testid="card-available"
          >
            {usage.availableMinor < 0 ? (
              `Over the limit by ${formatMinor(-usage.availableMinor, currency)}`
            ) : compact ? (
              <>
                {formatMinor(usage.availableMinor, currency)} available of {formatMinor(limit, currency)}
              </>
            ) : (
              `Available ${formatMinor(usage.availableMinor, currency)} of ${formatMinor(limit, currency)}`
            )}
          </div>
        )}
    </>
  );

  const actions = (
    <ActionButtons
      actions={[
        ...(debit ? [] : [{ key: 'pay', label: 'Pay', glyph: <Banknote size={20} aria-hidden />, run: () => setPaying(true) }]),
        { key: 'spend', label: 'Spend', glyph: <ArrowUpRight size={20} aria-hidden />, to: '/transactions/new' as const, search: { mode: 'expense' as const, account: card.id } },
        // The statement's points, with the programme's page one row in; a card with no rewards sets them up first.
        cp.programme
          ? { key: 'points', label: unitLabel, glyph: <Gift size={20} aria-hidden />, ...toPoints }
          : { key: 'points', label: unitLabel, glyph: <Gift size={20} aria-hidden />, ...toSettings },
        ...(debit ? [] : [{ key: 'statement', label: 'Statement', glyph: <ReceiptText size={20} aria-hidden />, ...toStatement }]),
      ]}
    />
  );

  /*
   * The card's back: what is outstanding (or the credit the bank holds), the limit as it is used, and under a thin rule the nearest spend bonus with its
   * ring, or this statement's points. Opened from Wallet it is the raised card's own back (a tap on the card turns it
   * over); on the page's own it is a white box under the card.
   */
  const backFigure = cardBackFigure(owedMinor, creditMinor);
  const backFace = (className: string, style?: CSSProperties) => (
    <div data-testid={debit ? undefined : 'tile-left-to-pay'} className={cx('flex flex-col overflow-hidden bg-[var(--ph-surface)] text-[var(--ph-ink)]', className)} style={style}>
      {!debit && (
        <div className="min-w-0">
          <div data-testid="tile-figure-label" className="pr-[40px] text-[13px] leading-[18px] font-medium text-[var(--ph-ink-3)]">{backFigure.label}</div>
          <div data-testid="tile-unpaid-balance" className="tabular truncate text-[26px] leading-[30px] font-bold tracking-[-0.02em]">
            {formatMinor(backFigure.minor, currency)}
          </div>
          <div className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{billCaption()}</div>
          {limitBlock(true)}
        </div>
      )}
      <div data-testid="tile-points" className={debit ? undefined : 'mt-auto'}>
        <BackSlot
          cardId={card.id}
          items={bonuses.items}
          unit={unit}
          currency={currency}
          challengeNote={feeStatus.data?.waived && challengeCoversFee(feeStatus.data.challengeYear, feeStatus.data.year) ? waivedLine(feeStatus.data, currency) : null}
          points={cp.program ? { total: pointsBalance?.total ?? 0, posted: pointsBalance?.posted ?? 0, estimated: pointsBalance?.estimated ?? 0 } : null}
        />
      </div>
    </div>
  );

  const below = (
    <>
      {setup && <div className="-mt-[10px]">{setup}</div>}
      {instalments}
      {recent}
    </>
  );

  // The dots keep their height while the card is turned over, so the page below does not move.
  const turned = slot?.flipped === true;
  const dots =
    cards.length > 1 ? (
      <div className={cx(turned && 'invisible')} aria-hidden={turned || undefined}>
        <PageDots
          names={cards.map((piece) => piece.id)}
          index={shownIndex}
          onSelect={setShownIndex}
          label="Cards on this account"
          semantics="pressed"
          className="mt-2 mb-2"
          ariaLabelOf={(i) => `Show card ending ${cards[i]?.last4 ?? 'unknown'}${cards[i]?.holderName ? `, ${cards[i]?.holderName}` : ''}`}
          titleOf={(i) => `···· ${cards[i]?.last4 ?? '????'}${cards[i]?.holderName ? ` ${cards[i]?.holderName}` : ''}`}
        />
      </div>
    ) : null;

  return (
    <>
      {slot ? (
        <>
          <div data-testid="wallet-slot" aria-hidden style={{ width: slot.width, height: slot.height, maxWidth: '100%', pointerEvents: 'none' }} />
          {slot.backHost && createPortal(backFace('h-full w-full px-4 py-[14px]', { borderRadius: backRadius(slot.width), pointerEvents: 'auto' }), slot.backHost)}
          {dots}
          <div className="mt-[14px] flex min-w-0 flex-col">
            {actions}
            {below}
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
            <div className="min-w-0">
              <div ref={faceBox} data-testid="card-face-swipe" className="w-fit max-w-full" style={lastIndex >= 1 ? { touchAction: 'pan-y' } : undefined} {...faceSwipe.handlers}>
                <CardFace
                  issuer={issuer}
                  name={card.name}
                  last4={shown?.last4 ?? null}
                  holderName={shown?.holderName}
                  network={cp.catalog.entry?.network}
                  look={cp.catalog.entry?.look}
                  className="!w-[17rem] max-w-full"
                />
              </div>
              {dots}
            </div>
            <div className="flex min-w-0 flex-col">
              {backFace('mb-4 rounded-[14px] px-4 py-[14px]')}
              {actions}
            </div>
          </div>
          <div className="mt-[6px]">{below}</div>
        </>
      )}
      {paying && (
        <PaySheet
          card={card}
          accounts={accounts}
          amountMinor={leftToPayMinor || owedMinor}
          today={today}
          onDone={() => {
            setPaying(false);
            fromLink.done();
          }}
        />
      )}
    </>
  );
}
