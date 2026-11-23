import { formatMinor, isoDate } from '@expanses/core';
import type { GoalLinkRow, GoalPlanRow } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { MONEY_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts } from '../../lib/queries';
import { cx, Money } from '../../ui';
import { Tag } from '../../ui/desk';
import { iconTint, RowIcon } from '../../ui/native';
import { PEEK_BUTTON, SidePeek } from '../../ui/native/SidePeek';
import { UseBar } from '../budget/budget-rows';
import { LinkAmount } from './funding';
import { fundingLines } from './funding-lines';
import { type GoalCard, GOAL_KIND_MARKS } from './goal-cards';
import { historySubtitle, historyTitle } from './history-lines';
import { useGoalHistory, useGoalShares } from './queries';

/** How many history lines the peek lists; the goal's History page has them all. */
const RECENT_SHOWN = 3;
const H3 = 'flex items-baseline justify-between gap-2 border-t border-[var(--ph-hair)] px-[14px] pt-[10px] pb-[4px] text-[11px] font-semibold tracking-[0.04em] text-[var(--ph-ink-3)] uppercase';
const LINE = 'flex w-full items-baseline gap-[8px] px-[14px] py-[5px] text-left text-[13px] text-[var(--ph-ink)]';

/** The sheets the peek opens, each the goal page's own. */
export type GoalSheetName = 'tag' | 'use' | 'monthly';

/** Initials on a shared goal: small grey pills, as the iPhone's list draws them. */
export function Initials({ initials, testId, selected = false }: { initials: readonly string[]; testId?: string; selected?: boolean }) {
  return (
    <span className="flex shrink-0 gap-[2px]" data-testid={testId} aria-hidden>
      {initials.map((one, index) => (
        <span key={index} className={cx('rounded-full px-[5px] text-[10.5px] leading-[16px] font-semibold', selected ? 'bg-white/25 text-white' : 'bg-[var(--ph-fill)] text-[var(--ph-ink-2)]')}>
          {one}
        </span>
      ))}
    </span>
  );
}

/** A goal's kind, as the iPhone's list draws it: its glyph in its colour, on a 12 % wash of it. */
export function KindIcon({ kind, size = 22 }: { kind: GoalCard['kind']; size?: number }) {
  const { Glyph, colour } = GOAL_KIND_MARKS[kind];
  return (
    <RowIcon tint={iconTint(colour)} size={size}>
      <Glyph size={Math.round(size * 0.55)} strokeWidth={2.2} aria-hidden />
    </RowIcon>
  );
}

/**
 * A goal in Mac Goals' side peek — its own page, in brief: when it is for and how it stands, the target, the bar, what is
 * saved and to go; Set aside, Tag a purchase, Use (while something is set aside) and Monthly, the goal page's own sheets;
 * what it needs each month; what funds it, with the total; the latest history, who did it on a shared goal, and the way
 * to all of it. Every figure is the card's (`goalCard`), as the iPhone's goal page reads it.
 */
export function GoalPeek({
  plan,
  card,
  initials,
  held,
  top,
  first,
  last,
  onStep,
  onClose,
  onOpen,
  onSetAside,
  onSheet,
}: {
  plan: GoalPlanRow;
  card: GoalCard;
  initials: readonly string[] | null;
  /** Something is set aside for it, so Use has something to use. */
  held: boolean;
  top: number;
  first: boolean;
  last: boolean;
  onStep: (by: -1 | 1) => void;
  onClose: () => void;
  onOpen: () => void;
  /** Set aside, with the caret in one account's figure when opened from its Funded-by line. */
  onSetAside: (accountId?: string) => void;
  onSheet: (sheet: GoalSheetName) => void;
}) {
  const navigate = useNavigate();
  const today = isoDate();
  const accounts = useAccounts().data ?? [];
  const share = useGoalShares().data?.[card.goalId] ?? null;
  const shared = share?.state === 'on';
  const nameOf = (memberId: string) => share?.members.find((member) => member.memberId === memberId)?.name ?? 'Member';
  const history = useGoalHistory().data?.[card.goalId] ?? [];
  const currency = plan.currency;
  const warn = card.statusTone === 'warn';

  // The goal page's own three parts: paid, saved, to go. Held money never pushes the bar past the whole.
  const paidShare = card.targetMinor > 0 ? Math.min(1, card.paidMinor / card.targetMinor) : 0;
  const savedShare = card.targetMinor > 0 ? Math.min(1 - paidShare, card.currentMinor / card.targetMinor) : 0;
  const toGoMinor = card.targetMinor > 0 ? Math.max(0, card.targetMinor - card.paidMinor - card.currentMinor) : 0;
  const when = card.kind === 'emergency' ? (card.coverLabel ?? `by ${card.dueLabel}`) : card.done ? 'done' : `by ${card.dueLabel}`;

  // This device's own set-aside line opens Set aside with the caret in that account (the goal page's rule).
  const settable = new Set(moneyHolders(accounts).filter((account) => MONEY_SUBTYPES.includes(account.subtype)).map((account) => account.id));
  const asideFrom = (link: GoalLinkRow) => (link.kind === 'earmark' && link.owner === undefined && settable.has(link.accountId) ? () => onSetAside(link.accountId) : undefined);
  const memberOf = (link: GoalLinkRow) => (link.owner !== undefined ? nameOf(link.owner) : null);

  return (
    <SidePeek
      top={top}
      label="Goal details"
      testId="goal-peek"
      titleTestId="peek-title"
      noun="goal"
      title={
        <span className="flex min-w-0 items-center gap-[8px]">
          <KindIcon kind={card.kind} size={26} />
          <span className="min-w-0 break-words">{card.name}</span>
          {initials && <Initials initials={initials} testId="peek-initials" />}
        </span>
      }
      first={first}
      last={last}
      onStep={onStep}
      onClose={onClose}
    >
      <div className="flex items-baseline justify-between gap-3 px-[14px] pt-[2px] pb-[4px]">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase" data-testid="peek-when">
          {when}
        </span>
        <Tag tone={warn ? 'orange' : card.done || card.statusLabel === 'Funded' ? 'grey' : 'green'} testId="peek-status">
          {card.statusLabel}
        </Tag>
      </div>
      <div className="px-[14px] pb-[10px]">
        <div className="text-[24px] leading-[30px] font-extrabold tracking-[-0.3px] tabular-nums text-[var(--mk-ink)]" data-testid="peek-target">
          {formatMinor(card.targetMinor > 0 ? card.targetMinor : card.currentMinor, currency)}
        </div>
        <div className="my-[8px]">
          <UseBar
            share={card.done ? 1 : Math.min(1, card.progressPercent / 100)}
            height={6}
            warn={warn}
            label={`${card.name} progress`}
            segments={
              card.targetMinor > 0
                ? [
                    { share: paidShare, colour: 'var(--ph-ink-3)' },
                    { share: savedShare, colour: warn ? 'var(--ph-warn)' : 'var(--ph-up)' },
                  ]
                : undefined
            }
          />
        </div>
        <div className="flex flex-wrap gap-x-[14px] text-[12px] text-[var(--ph-ink)]">
          {card.paidMinor > 0 && (
            <span data-testid="peek-paid">
              <span className="text-[var(--ph-ink-3)]">Paid</span> <Money minor={card.paidMinor} currency={currency} />
            </span>
          )}
          <span data-testid="peek-saved">
            <span className="text-[var(--ph-ink-3)]">Saved</span> <Money minor={card.currentMinor} currency={currency} />
          </span>
          {toGoMinor > 0 && (
            <span data-testid="peek-togo">
              <span className="text-[var(--ph-ink-3)]">To go</span> <Money minor={toGoMinor} currency={currency} />
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-[6px] px-[14px] pb-[12px]">
        <button type="button" className={PEEK_BUTTON} onClick={() => onSetAside()}>
          Set aside
        </button>
        <button type="button" className={PEEK_BUTTON} onClick={() => onSheet('tag')}>
          Tag a purchase
        </button>
        {held && (
          <button type="button" className={PEEK_BUTTON} onClick={() => onSheet('use')}>
            Use
          </button>
        )}
        <button type="button" className={PEEK_BUTTON} onClick={() => onSheet('monthly')}>
          Monthly
        </button>
        <button type="button" className={PEEK_BUTTON} onClick={onOpen}>
          Open
        </button>
      </div>

      {/* A goal that needs nothing more a month has nothing to plan, as on its page. */}
      {plan.status !== 'funded' && !card.done && (
        <>
          <h3 className={H3}>Each month</h3>
          <div data-testid="peek-each-month" className="pb-[4px]">
            <div className={LINE}>
              <span className="min-w-0 flex-1">Needed a month</span>
              <Money minor={card.neededMonthlyMinor} currency={currency} />
            </div>
            <div className={LINE}>
              <span className="min-w-0 flex-1">Set up a month</span>
              <Money minor={card.plannedMonthlyMinor} currency={currency} />
            </div>
            {card.differenceMinor < 0 && (
              <div className={LINE} data-testid="peek-short-by">
                <span className="min-w-0 flex-1">Short by</span>
                <span className="text-[var(--ph-warn)]">
                  <Money minor={-card.differenceMinor} currency={currency} />
                </span>
              </div>
            )}
          </div>
        </>
      )}

      <h3 className={H3}>
        <span>Funded by</span>
        {plan.links.length > 0 && <span data-testid="peek-funded-total">{formatMinor(plan.currentMinor, currency)}</span>}
      </h3>
      <ul aria-label="Funded by" data-testid="peek-funded-by" className="pb-[4px]">
        {plan.links.length === 0 && <li className="px-[14px] py-[5px] text-[12.5px] text-[var(--ph-warn)]">Nothing yet. Tag a purchase or set money aside.</li>}
        {fundingLines(plan.links, accounts, currency).map((line) => {
          if (line.type === 'account')
            return (
              <li key={line.key} className={LINE} data-testid="peek-funding-row">
                <span className="min-w-0 flex-1 break-words">{line.name}</span>
                <span className="shrink-0 tabular-nums">
                  {line.approx ? '≈ ' : ''}
                  {formatMinor(line.goalMinor, currency)}
                </span>
              </li>
            );
          const set = asideFrom(line.link);
          const member = memberOf(line.link);
          const body = (
            <>
              <span className="min-w-0 flex-1 break-words">
                {line.link.name}
                {member && <span className="text-[var(--ph-ink-3)]"> · {member}</span>}
              </span>
              <span className={cx('shrink-0 text-right tabular-nums', line.short && 'text-[var(--ph-warn)]')}>
                <LinkAmount link={line.link} goalCurrency={currency} />
              </span>
            </>
          );
          return (
            <li key={line.key}>
              {set ? (
                <button type="button" data-testid="peek-funding-row" onClick={set} className={cx(LINE, 'hover:bg-[var(--ph-fill)]')} title="Set aside in this account">
                  {body}
                </button>
              ) : (
                <div data-testid="peek-funding-row" className={LINE}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <h3 className={H3}>History</h3>
      <ul aria-label="History" data-testid="peek-history">
        {history.length === 0 && <li className="px-[14px] py-[5px] text-[12.5px] text-[var(--ph-ink-3)]">Nothing yet.</li>}
        {history.slice(0, RECENT_SHOWN).map((entry) => (
          <li key={entry.key} className={LINE} data-testid="peek-history-row">
            <span className="min-w-0 flex-1">
              <span className="block break-words">{historyTitle(entry)}</span>
              <span className="block text-[11.5px] text-[var(--ph-ink-3)]">{historySubtitle(entry, today, nameOf, shared, share?.me)}</span>
            </span>
            {entry.amountMinor !== null && <Money minor={entry.amountMinor} currency={entry.currency} className="shrink-0" />}
          </li>
        ))}
      </ul>
      {history.length > 0 && (
        <button
          type="button"
          data-testid="peek-all-history"
          onClick={() => void navigate({ to: '/goals/$goalId/history', params: { goalId: card.goalId } })}
          className="mb-3 flex items-center justify-between px-[14px] py-[6px] text-[13px] font-semibold text-[var(--mk-blue)] hover:bg-[var(--mk-hover)]"
        >
          All {history.length} {history.length === 1 ? 'entry' : 'entries'}
          <ChevronRight size={14} aria-hidden />
        </button>
      )}
      {card.riskWarning && <p className="px-[14px] pb-3 text-[12px] text-[var(--ph-warn)]">{card.riskWarning}</p>}
    </SidePeek>
  );
}
