import { formatMinor, installmentSplit, minorToMajorString, parseMajor, transferLines } from '@expanses/core';
import { type AccountRow, cardStatement, type CardRow, postTransaction } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { isMoneyAccount, useInvalidateAll } from '../../lib/queries';
import { Button, cx, ErrorBox, Field, Input, Select } from '../../ui';
import { CardFace } from './CardFace';
import { bonusStanding, activeDuring } from './catalog-panel';
import { cycleBack, dueDateAfter, dueIn } from './statement-dates';
import { limitUsage } from './limit-usage';
import { pointsSummary } from './points-summary';
import { useInstallments } from '../loans/queries';
import { type CardPoints, formatPoints, shortDate } from './useCardPoints';

export type CardTab = 'statement' | 'points' | 'rules' | 'card';

export const CARD_TABS: { key: CardTab; label: string }[] = [
  { key: 'statement', label: 'Statement' },
  { key: 'points', label: 'Points' },
  { key: 'rules', label: 'Rewards rules' },
  { key: 'card', label: 'Card & plans' },
];

function Tile({ label, children, testId, action }: { label: string; children: ReactNode; testId: string; action?: ReactNode }) {
  return (
    <section data-testid={testId} className="relative flex min-w-0 flex-col rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
      <div className="truncate text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</div>
      {children}
      {action && <div className="mt-auto flex items-center gap-2 pt-2">{action}</div>}
    </section>
  );
}

/** Pays the card in full or in part from a bank account: one transfer, the same as recording it by hand. */
function PayForm({ card, accounts, amountMinor, today, onDone }: { card: AccountRow; accounts: readonly AccountRow[]; amountMinor: number; today: string; onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const currency = card.currency ?? ws.baseCurrency;
  // Only money that can pay a bill: bank, savings and cash, not holdings such as gold or shares.
  const payers = accounts.filter((a) => isMoneyAccount(a) && ['bank', 'savings', 'cash'].includes(a.subtype) && a.currency === currency);
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void pay();
      }}
    >
      <Field label="Paid from">
        <Select value={fromId} onChange={(event) => setFromId(event.target.value)}>
          {payers.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={`Amount (${currency})`}>
          <Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Paid on">
          <Input type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
        </Field>
      </div>
      <ErrorBox error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Record payment
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * The top of a card's page: the card itself with how much of the limit is used, then what the page is usually
 * opened for — the current bill, and the points: the balance beside what this cycle is adding.
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
  tabs,
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
  /** The page's tabs, drawn under the three tiles. */
  tabs: ReactNode;
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
  const result = cp.current;
  const bonus = result ? cp.bonuses.find((b) => activeDuring(b, result.cycle.end, result.cycle.end)) : undefined;
  const standing = bonus && result ? bonusStanding(bonus, result.earn.eligibleSpendByBonus[bonus.id] ?? 0, result.earn.bonusById[bonus.id] ?? 0) : null;

  const dueOn = lastCycle && cp.terms ? dueDateAfter(lastCycle.end, cp.terms.dueDay) : null;
  // The statement already bills instalment plans a month at a time, so this is what the bank asks for.
  const leftToPayMinor = last.data?.leftToPayMinor ?? 0;
  const owing = leftToPayMinor > 0;
  const due = dueOn ? dueIn(today, dueOn) : null;

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
          className="!w-[17rem]"
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
                className={cx('h-2 rounded-full transition-all', index === shownIndex ? 'w-5 bg-slate-900' : 'w-2 bg-slate-300 hover:bg-slate-400')}
              />
            ))}
          </div>
        )}
        {usage.usedPct !== null && (
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-200" data-testid="limit-bar">
            <div className={cx('h-full', (usage.usedPct ?? 0) >= 80 ? 'bg-amber-500' : 'bg-slate-900')} style={{ width: `${usage.barUsedPct}%` }} />
            {usage.barHeldPct > 0 && (
              <div
                className="h-full"
                title="Held by instalments"
                style={{ width: `${usage.barHeldPct}%`, backgroundImage: 'repeating-linear-gradient(135deg, #475569 0 3px, #94a3b8 3px 6px)' }}
              />
            )}
          </div>
        )}
        {!debit && (
          <div className="mt-1 text-xs text-slate-500" data-testid="card-owed">
            Used {formatMinor(usage.usedMinor, currency)}
            {usage.usedPct !== null ? ` · ${usage.usedPct}%` : ''}
          </div>
        )}
        {usage.heldMinor > 0 && (
          <div
            className="relative text-xs text-slate-500"
            data-testid="card-instalments"
            onMouseEnter={() => setShowHeld(true)}
            onMouseLeave={() => setShowHeld(false)}
            onFocus={() => setShowHeld(true)}
            onBlur={() => setShowHeld(false)}
          >
            <span tabIndex={0} aria-describedby={showHeld ? 'held-by-plans' : undefined} className="cursor-help underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-slate-900">
              Instalments hold {formatMinor(usage.heldMinor, currency)}
            </span>
            {/* Each plan and what it still holds, on hover or keyboard focus. */}
            {showHeld && (
              <div id="held-by-plans" role="tooltip" className="absolute top-full left-0 z-20 mt-1 w-80 rounded-lg bg-slate-900 p-2.5 text-xs text-white shadow-lg">
                {holding.map(({ plan, split }) => (
                  <div key={plan.id} className="flex justify-between gap-3 py-0.5">
                    <span className="min-w-0">{plan.description}</span>
                    <span className="shrink-0 tabular text-slate-300">
                      {formatMinor(split.unbilledMinor, currency)} · {split.monthsLeft} of {plan.months} left
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {usage.availableMinor !== null && limit !== null && (
          <div className={cx('text-xs', usage.availableMinor < 0 ? 'font-medium text-red-700' : 'text-slate-500')} data-testid="card-available">
            {usage.availableMinor < 0 ? `Over the limit by ${formatMinor(-usage.availableMinor, currency)}` : `Available ${formatMinor(usage.availableMinor, currency)} of ${formatMinor(limit, currency)}`}
          </div>
        )}
      </div>

      {/* The current bill and the points, then the tabs directly under them, so the whole block sits beside the card. */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className={cx('grid min-w-0 flex-1 gap-3', !debit && 'md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]')}>
          {!debit && (
          <Tile
            label="Current bill"
            testId="tile-left-to-pay"
            action={
              cp.terms && lastCycle ? (
                <Button className="px-2.5 py-1 text-xs" onClick={() => setPaying((open) => !open)} aria-expanded={paying}>
                  Pay
                </Button>
              ) : (
                <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => onTab('card')}>
                  Enter billing date
                </Button>
              )
            }
          >
            {cp.terms && lastCycle ? (
              <>
                <div className="mt-1 truncate text-xl font-semibold tabular">{formatMinor(leftToPayMinor, currency)}</div>
                {last.data && last.data.closingMinor > 0 ? (
                  owing && dueOn && due ? (
                    <>
                      <div className="mt-0.5 text-xs text-slate-700" data-testid="due-date">
                        Due {shortDate(dueOn)} ·{' '}
                        <span className={cx(due.tone === 'late' && 'font-semibold text-red-700', due.tone === 'soon' && 'font-semibold text-amber-700')}>{due.text}</span>
                      </div>
                      <div className="text-xs text-slate-500">Statement of {shortDate(lastCycle.end)}</div>
                    </>
                  ) : (
                    <div className="mt-0.5 text-xs text-slate-500">
                      Paid in full · statement of {shortDate(lastCycle.end)}
                    </div>
                  )
                ) : (
                  <div className="mt-0.5 text-xs text-slate-500">Nothing billed on {shortDate(lastCycle.end)}</div>
                )}
              </>
            ) : (
              <div className="mt-1 text-xs text-slate-600">Add the billing date to see statements.</div>
            )}
            {paying && (
              <div className="absolute top-full right-0 left-0 z-20 mt-2 rounded-xl bg-white p-3 shadow-lg ring-1 ring-slate-200 md:left-auto md:w-80">
                <PayForm card={card} accounts={accounts} amountMinor={leftToPayMinor || owedMinor} today={today} onDone={() => setPaying(false)} />
              </div>
            )}
          </Tile>
          )}

          <Tile
            label={unit === 'miles' ? 'Miles' : unit === 'cashback' ? 'Cashback' : 'Points'}
            testId="tile-points"
            action={
              cp.program ? (
                <>
                  {pointsBalance && (
                    <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => onTab('points', 'spend-points')}>
                      Use {unit}
                    </Button>
                  )}
                  {result && (
                    <button type="button" onClick={() => onTab('points')} className="px-1 text-xs text-slate-600 underline underline-offset-2 hover:text-slate-900">
                      See by rule
                    </button>
                  )}
                </>
              ) : (
                <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => onTab(cp.terms ? 'rules' : 'card')}>
                  Open rewards rules
                </Button>
              )
            }
          >
            {cp.program ? (
              <>
                <div className="mt-1 truncate text-xl font-semibold tabular" data-testid="tile-points-balance">
                  {formatPoints(pointsBalance?.total ?? 0)} {unit}
                </div>
                {/* Posted, then what this cycle is adding; the cycle's dates are on hover, the spend is in the Points tab. */}
                <div
                  className="mt-0.5 text-xs text-slate-500"
                  data-testid="tile-this-cycle"
                  title={result ? `This cycle: ${shortDate(result.cycle.start)} – ${shortDate(result.cycle.end)}` : undefined}
                >
                  {pointsSummary(pointsBalance?.posted ?? 0, pointsBalance?.estimated ?? 0, result ? result.earn.totalPoints : null)}
                </div>
                {standing && standing.next && (
                  <div className="mt-2 flex items-center gap-2" title={`${bonus!.name}: ${formatMinor(standing.eligibleSpendMinor, currency)} of ${formatMinor(standing.next.minSpendMinor, currency)}`}>
                    <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.round(standing.fraction * 100)}%` }} />
                    </div>
                    <span className="min-w-0 truncate text-xs text-slate-500 tabular">
                      {formatMinor(standing.remainingMinor, currency)} more for +{formatPoints(standing.next.bonus)} bonus
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-1 text-xs text-slate-600">Rewards are not set up for this card.</div>
            )}
          </Tile>
        </div>
        <div>{tabs}</div>
      </div>
    </div>
  );
}

export function CardTabs({ active, onChange, debit = false }: { active: CardTab; onChange: (tab: CardTab) => void; debit?: boolean }) {
  // A debit card has no statement: its spending settles against the account as it happens.
  const shown = debit ? CARD_TABS.filter((tab) => tab.key !== 'statement') : CARD_TABS;
  return (
    <div role="tablist" aria-label="Card sections" className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {shown.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={cx(
            '-mb-px border-b-2 px-4 py-2.5 text-sm whitespace-nowrap',
            active === tab.key ? 'border-slate-900 font-semibold text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-900',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
