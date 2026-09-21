import { formatMinor, installmentSplit, minorToMajorString, parseMajor, transferLines } from '@expanses/core';
import { type AccountRow, cardStatement, type CardRow, postTransaction } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { isMoneyAccount, useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ProgressBar, type Segment, SegmentedControl, SelectRow, TextRow } from '../../ui/native';
import { CardFace } from './CardFace';
import { bonusStanding, activeDuring } from './catalog-panel';
import { cycleBack, dueDateAfter, dueIn } from './statement-dates';
import { limitUsage } from './limit-usage';
import { pointsSummary } from './points-summary';
import { useInstallments } from '../loans/queries';
import { type CardPoints, formatPoints, shortDate } from './useCardPoints';

export type CardTab = 'statement' | 'points' | 'rules' | 'card';

/**
 * The card page's four sections, as the segmented control takes them.
 *
 * Four is the limit at phone width, and the four only fit because the page supplies the short form: "Rewards
 * rules" is drawn as "Rules". The labels are decided at a phone's 390 px whatever the window is, so the control
 * reads the same on both and a name never changes under a reader who has learnt it.
 */
export const CARD_TABS: (Segment & { key: CardTab })[] = [
  { key: 'statement', label: 'Activity' },
  { key: 'points', label: 'Points' },
  { key: 'rules', label: 'Rewards rules', short: 'Rules' },
  { key: 'card', label: 'Card' },
];

/** A figure that is the point of its tile: 22 px, tabular, and never money that a caller formatted itself. */
function TileFigure({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className="tabular text-[22px] leading-[28px] font-extrabold tracking-[-0.02em] text-[var(--ph-ink)]">
      {children}
    </span>
  );
}

/** Pays the card in full or in part from a bank account: one transfer, the same as recording it by hand. */
function PayForm({ card, accounts, amountMinor, today, onDone }: { card: AccountRow; accounts: readonly AccountRow[]; amountMinor: number; today: string; onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const currency = card.currency ?? ws.baseCurrency;
  // Only money that can pay a bill: bank, savings and cash, not holdings such as gold or shares.
  const payers = accounts.filter((a) => isMoneyAccount(a) && SPENDABLE_SUBTYPES.includes(a.subtype) && a.currency === currency);
  const [fromId, setFromId] = useState(payers[0]?.id ?? '');
  const [amount, setAmount] = useState(minorToMajorString(amountMinor, currency));
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function pay() {
    setError(null);
    setBusy(true);
    try {
      const minor = parseMajor(amount, currency);
      if (!(minor > 0)) throw new Error('Enter the amount paid');
      if (!fromId) throw new Error(`Add a ${currency} bank account to pay the card from`);
      await postTransaction(database, ws, { occurredOn: paidOn, description: `${card.name} payment`, lines: transferLines({ fromAccountId: fromId, toAccountId: card.id, amountMinor: minor, currency }) });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    }finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void pay();
      }}
    >
      <InsetGroup header="Pay this bill" wide>
        <SelectRow label="Paid from" value={fromId} onChange={(event) => setFromId(event.target.value)}>
          {payers.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectRow>
        <TextRow label={`Amount (${currency})`} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
        <TextRow label="Paid on" type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
        <InsetRow
          title={<span className={cx(busy ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-tint)]')}>Record payment</span>}
          onClick={() => void pay()}
          chevron={false}
        />
        <InsetRow title={<span className="text-[var(--ph-ink-2)]">Cancel</span>} onClick={onDone} chevron={false} />
      </InsetGroup>
      {/* Hidden, so Enter in any field still records the payment; a visible second button would be a second target. */}
      <input type="submit" hidden />
      <ErrorBox error={error} />
    </form>
  );
}

/**
 * The top of a card's page: layout D2.
 *
 * The card itself with how much of the limit is used, then the two figures the page is opened for — the current
 * bill and the points — as equals, and the four sections under them as a segmented control.
 *
 * On a wide screen the art keeps its column beside the tiles rather than the tiles being stretched across it.
 */
export function CardHero({
  cp,
  accounts,
  plastic,
  issuer,
  owedMinor,
  debit = false,
  pointsBalance,
  today,
  onTab,
}: {
  cp: CardPoints;
  accounts: readonly AccountRow[];
  plastic: readonly CardRow[];
  issuer: string | null;
  owedMinor: number;
  /** A debit card spends money the account already holds: nothing is owed, nothing is due, nothing to pay. */
  debit?: boolean;
  pointsBalance: { total: number; posted: number; estimated: number } | null;
  today: string;
  onTab: (tab: CardTab, focusId?: string) => void;
}) {
  const { database, ws } = useApp();
  const card = cp.card;
  const currency = card.currency ?? ws.baseCurrency;
  const [paying, setPaying] = useState(false);
  const cards = [...plastic].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  const [shownIndex, setShownIndex] = useState(0);
  const [showHeld, setShowHeld] = useState(false);
  const shown = cards[Math.min(shownIndex, Math.max(0, cards.length - 1))];
  const limit = cp.terms?.creditLimitMinor ?? null;
  const plans = useInstallments(card.id);
  const holding = (plans.data ?? []).map((plan) => ({ plan, split: installmentSplit(plan, today) })).filter(({ split }) => split.unbilledMinor > 0);
  const usage = limitUsage(owedMinor, limit, holding.reduce((sum, { split }) => sum + split.unbilledMinor, 0));

  const lastCycle = cp.terms ? cycleBack(today, cp.terms.statementDay, 1) : null;
  const last = useQuery({
    queryKey: ['card-statement', ws.workspaceId, card.id, lastCycle?.start ?? '-', today],
    enabled: lastCycle !== null,
    queryFn: () => cardStatement(database, ws, card.id, lastCycle!, today),
  });

  const unit = cp.program?.unit ?? 'points';
  const unitLabel = unit === 'miles' ? 'Miles' : unit === 'cashback' ? 'Cashback' : 'Points';
  const result = cp.current;
  const bonus = result ? cp.bonuses.find((b) => activeDuring(b, result.cycle.end, result.cycle.end)) : undefined;
  const standing = bonus && result ? bonusStanding(bonus, result.earn.eligibleSpendByBonus[bonus.id] ?? 0, result.earn.bonusById[bonus.id] ?? 0) : null;

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

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="min-w-0">
        <CardFace
          issuer={issuer}
          name={card.name}
          last4={shown?.last4 ?? null}
          holderName={shown?.holderName}
          network={cp.catalog.entry?.network}
          look={cp.catalog.entry?.look}
          className="!w-[17rem] max-w-full"
        />
        {/* One statement can carry several cards; the dots show each one's face in turn. */}
        {cards.length > 1 && (
          <div className="mt-2 flex items-center justify-center gap-1.5" role="group" aria-label="Cards on this account">
            {cards.map((piece, index) => (
              <button
                key={piece.id}
                type="button"
                aria-label={`Show card ending ${piece.last4 ?? 'unknown'}${piece.holderName ? `, ${piece.holderName}` : ''}`}
                aria-pressed={index === shownIndex}
                title={`···· ${piece.last4 ?? '????'}${piece.holderName ? ` ${piece.holderName}` : ''}`}
                onClick={() => setShownIndex(index)}
                className={cx(
                  'ph-focus h-2 rounded-full transition-all',
                  index === shownIndex ? 'w-5 bg-[var(--ph-ink)]' : 'w-2 bg-[var(--ph-chevron)]',
                )}
              />
            ))}
          </div>
        )}
        {/*
         * The limit bar. Two fills, not one: what is owed outright, and the part of it an instalment plan has not
         * billed yet — which is why `ProgressBar` cannot draw it. The tokens are the kit's all the same.
         */}
        {usage.usedPct !== null && (
          <div className="mt-2 flex h-[7px] overflow-hidden rounded-full bg-[var(--ph-track)]" data-testid="limit-bar">
            <div
              className="h-full"
              style={{ width: `${usage.barUsedPct}%`, background: (usage.usedPct ?? 0) >= 80 ? 'var(--ph-warn)' : 'var(--ph-tint)' }}
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
        {!debit && (
          <div className="mt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="card-owed">
            Used {formatMinor(usage.usedMinor, currency)}
            {usage.usedPct !== null ? ` · ${usage.usedPct}%` : ''}
          </div>
        )}
        {usage.heldMinor > 0 && (
          <div
            className="relative text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]"
            data-testid="card-instalments"
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
            className={cx('text-[12.5px] leading-[16px]', usage.availableMinor < 0 ? 'font-medium text-[var(--ph-alarm)]' : 'text-[var(--ph-ink-3)]')}
            data-testid="card-available"
          >
            {usage.availableMinor < 0 ? `Over the limit by ${formatMinor(-usage.availableMinor, currency)}` : `Available ${formatMinor(usage.availableMinor, currency)} of ${formatMinor(limit, currency)}`}
          </div>
        )}
      </div>

      {/* The bill and the points as equals. The sections follow the whole hero, in a column of their own. */}
      <div className="flex min-w-0 flex-col">
        {!debit && (
          <div data-testid="tile-left-to-pay">
            <InsetGroup header="Current bill" wide>
              <InsetRow title={<TileFigure>{cp.terms && lastCycle ? formatMinor(leftToPayMinor, currency) : '—'}</TileFigure>} subtitle={billCaption()} />
              {!paying &&
                (cp.terms && lastCycle ? (
                  <InsetRow title={<span className="text-[var(--ph-tint)]">Pay this bill</span>} onClick={() => setPaying(true)} />
                ) : (
                  <InsetRow title={<span className="text-[var(--ph-tint)]">Enter billing date</span>} onClick={() => onTab('card')} />
                ))}
            </InsetGroup>
            {paying && <PayForm card={card} accounts={accounts} amountMinor={leftToPayMinor || owedMinor} today={today} onDone={() => setPaying(false)} />}
          </div>
        )}

        <div data-testid="tile-points">
          <InsetGroup header={unitLabel} wide>
            {cp.program ? (
              <InsetRow
                title={
                  <TileFigure testId="tile-points-balance">
                    {formatPoints(pointsBalance?.total ?? 0)} {unit}
                  </TileFigure>
                }
                /* Posted, then what this cycle is adding; the cycle's dates are on hover, the spend is in Points. */
                subtitle={
                  <span
                    data-testid="tile-this-cycle"
                    title={result ? `This cycle: ${shortDate(result.cycle.start)} – ${shortDate(result.cycle.end)}` : undefined}
                  >
                    {pointsSummary(pointsBalance?.posted ?? 0, pointsBalance?.estimated ?? 0, result ? result.earn.totalPoints : null)}
                  </span>
                }
              />
            ) : (
              <InsetRow title={<TileFigure>—</TileFigure>} subtitle="Rewards are not set up for this card." />
            )}
            {cp.program && standing && standing.next && (
              <InsetRow
                title={`${formatMinor(standing.remainingMinor, currency)} more`}
                subtitle={`for +${formatPoints(standing.next.bonus)} bonus · ${bonus!.name}`}
                value={
                  <ProgressBar
                    className="w-[70px]"
                    currentMinor={standing.eligibleSpendMinor}
                    targetMinor={standing.next.minSpendMinor}
                    label={`${bonus!.name}: ${formatMinor(standing.eligibleSpendMinor, currency)} of ${formatMinor(standing.next.minSpendMinor, currency)}`}
                  />
                }
              />
            )}
            {cp.program && pointsBalance && (
              <InsetRow title={<span className="text-[var(--ph-tint)]">Use {unit}</span>} onClick={() => onTab('points', 'spend-points')} />
            )}
            {cp.program && result && (
              <InsetRow title={<span className="text-[var(--ph-tint)]">See by rule</span>} onClick={() => onTab('points')} />
            )}
            {!cp.program && (
              <InsetRow title={<span className="text-[var(--ph-tint)]">Open rewards rules</span>} onClick={() => onTab(cp.terms ? 'rules' : 'card')} />
            )}
          </InsetGroup>
        </div>
      </div>
    </div>
  );
}

export function CardTabs({ active, onChange, debit = false }: { active: CardTab; onChange: (tab: CardTab) => void; debit?: boolean }) {
  // A debit card has no statement: its spending settles against the account as it happens.
  const shown = debit ? CARD_TABS.filter((tab) => tab.key !== 'statement') : CARD_TABS;
  return <SegmentedControl segments={shown} value={active} onChange={(key) => onChange(key as CardTab)} label="Card sections" className="mb-[18px]" />;
}
