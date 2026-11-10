import { formatMinor, fundingOrder, type GoalClass, goalClass, isoDate } from '@expanses/core';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { Empty, ErrorBox, Money } from '../../ui';
import { type CornerAction, type GroupChild, InsetGroup, InsetRow, LargeTitle, Panel, SCREEN } from '../../ui/native';
import { FigureRow, InfoButton, UseBar } from '../budget/budget-rows';
import { bareFigure } from '../networth/debt-rows';
import { InfoHeader } from './InfoHeader';
import { type GoalCard, goalCard, GOAL_KIND_MARKS, goalsTotals, onTrackLine } from './goal-cards';
import { initialsLine } from './goal-sharing';
import { useGoalPlans, useGoalShares } from './queries';

/** The page's two sections, in funding order: what is saved reaches the compulsory goals first. */
const SECTIONS: { key: GoalClass; title: string; note: string }[] = [
  { key: 'compulsory', title: 'Compulsory', note: 'The emergency fund and retirement. What is saved reaches these first.' },
  { key: 'additional', title: 'Additional', note: 'Everything else, from what is left.' },
];

/** "Short Rp 500.000 a month", with why behind its ⓘ. */
function ShortChip({ shortMinor, currency, why }: { shortMinor: number; currency: string; why: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center gap-[6px]">
        <span
          className="inline-flex min-h-[26px] items-center rounded-full bg-[var(--ph-warn-panel)] px-[10px] text-[13px] leading-[18px] font-medium text-[var(--ph-warn-ink)]"
          data-testid="goals-short"
        >
          Short {formatMinor(shortMinor, currency)} a month
        </span>
        <InfoButton label="the shortfall" open={open} onToggle={() => setOpen((was) => !was)} />
      </div>
      {open && <p className="pt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{why}</p>}
    </div>
  );
}

/** One goal: its kind's circle, name, date and status, a thin bar, and what is saved of what it costs. */
function GoalListRow({ card, currency, members, position }: GroupChild & { card: GoalCard; currency: string; members?: readonly string[] }) {
  const { Glyph, colour } = GOAL_KIND_MARKS[card.kind];
  const warn = card.statusTone === 'warn';
  return (
    <InsetRow
      position={position}
      testId="goal-row"
      icon={<Glyph size={15} strokeWidth={2.2} aria-hidden />}
      iconColour={colour}
      title={
        members ? (
          <span className="flex min-w-0 items-center gap-[6px]">
            <span className="truncate">{card.name}</span>
            <span className="flex shrink-0 gap-[2px]" data-testid="goal-row-initials" aria-hidden>
              {initialsLine(members).map((initials, index) => (
                <span key={index} className="rounded-full bg-[var(--ph-fill)] px-[5px] text-[10.5px] leading-[16px] font-semibold text-[var(--ph-ink-2)]">
                  {initials}
                </span>
              ))}
            </span>
          </span>
        ) : (
          card.name
        )
      }
      subtitle={
        <>
          <span className="block truncate">
            by {card.dueLabel} · <span className={warn ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-up)]'}>{card.statusLabel}</span>
          </span>
          <span className="mt-[6px] block">
            <UseBar share={card.done ? 1 : card.progressPercent / 100} warn={warn} />
          </span>
        </>
      }
      value={
        <span className="block text-right">
          <Money minor={card.currentMinor} currency={currency} />
          {card.targetMinor > 0 && <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">of {bareFigure(card.targetMinor, currency)}</span>}
        </span>
      }
      valueTone="ink"
      to="/goals/$goalId"
      params={{ goalId: card.goalId }}
    />
  );
}

export function GoalsPage() {
  const { ws } = useApp();
  const today = isoDate();
  const summary = useGoalPlans(today);
  const navigate = useNavigate();
  const shares = useGoalShares().data ?? {};

  const plans = summary.data?.plans ?? [];
  // The page's order is the funding order: compulsory goals first, each section in its own rank order.
  const ordered = fundingOrder(plans.map((plan) => ({ ...plan, kind: plan.goal.kind, rank: plan.goal.rank })));
  const cards = ordered.map((plan) => goalCard(plan));
  const totals = goalsTotals(cards);
  const shortfall = (summary.data?.neededMonthlyMinor ?? 0) - (summary.data?.capacityMonthlyMinor ?? 0);
  const fitting = summary.data?.fits.filter((fit) => fit.fits === 'full').length ?? 0;
  const currency = ws.baseCurrency;

  /* The primary action is a corner glyph at every width, not a dark rectangle beside the title. */
  const actions: CornerAction[] = [{ key: 'add', label: 'Add goal', glyph: <Plus size={22} aria-hidden />, run: () => void navigate({ to: '/goals/new' }) }];

  return (
    <div className={SCREEN}>
      <LargeTitle title="Goals" actions={actions} />
      <ErrorBox error={summary.error} />

      {summary.data && cards.length > 0 && (
        <>
          <Panel className="space-y-3" testId="goals-card">
            <div>
              <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Saved for goals</p>
              <p className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]" data-testid="goals-saved">
                {formatMinor(totals.savedMinor, currency)}
              </p>
            </div>
            <p className="text-[13px] leading-[18px] text-[var(--ph-ink-3)]" data-testid="goals-on-track">
              {onTrackLine(totals)}
            </p>
            {shortfall > 0 && (
              <ShortChip
                shortMinor={shortfall}
                currency={currency}
                why={`Goals ask for more each month than is saved. In funding order, ${fitting} of ${cards.length} fit in full and the rest wait. Move a date, lower a target, or reorder them.`}
              />
            )}
          </Panel>

          <InsetGroup>
            <FigureRow label="Needed a month" value={<Money minor={summary.data.neededMonthlyMinor} currency={currency} />} testId="goals-needed" />
            <FigureRow
              label="Set up a month"
              info="Monthly buys and standing transfers set up for the goals."
              value={<Money minor={summary.data.plannedMonthlyMinor} currency={currency} />}
              testId="goals-set-up"
            />
            <FigureRow
              label="Saved a month"
              info="Take-home pay minus spending minus loan principal, averaged over the last twelve months."
              value={<Money minor={summary.data.capacityMonthlyMinor} currency={currency} />}
              dim
              testId="goals-saved-monthly"
            />
          </InsetGroup>
        </>
      )}

      {cards.length === 0 && summary.isSuccess && <Empty>No goals yet.</Empty>}

      {SECTIONS.map((section) => {
        const inSection = ordered.map((plan, index) => ({ plan, card: cards[index]! })).filter(({ plan }) => goalClass(plan.goal.kind) === section.key);
        if (inSection.length === 0) return null;
        return (
          <section key={section.key} data-testid={`goals-${section.key}`} className="w-full md:max-w-2xl">
            <InfoHeader title={section.title} info={section.note} />
            {/* One row a goal: the figure is read at a glance here, and the goal itself opens on its own page. */}
            <InsetGroup>
              {inSection.map(({ card }) => (
                <GoalListRow key={card.goalId} card={card} currency={card.currency} members={shares[card.goalId]?.state === 'on' ? shares[card.goalId]!.members.map((member) => member.name) : undefined} />
              ))}
            </InsetGroup>
          </section>
        );
      })}
    </div>
  );
}
