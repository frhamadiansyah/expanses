import { formatMinor, isoDate } from '@expanses/core';
import { leaveSharedGoal, retagTrade, setStagePaid } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowRightLeft, CalendarClock, Check, DoorOpen, HandCoins, MoreHorizontal, Pencil, PiggyBank, ShoppingBag, Tag, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { ActionButtons, type CornerAction, InsetGroup, InsetRow, Panel, PushedTitle, type RoundAction, SCREEN } from '../../ui/native';
import { UseBar } from '../budget/budget-rows';
import { KeyItem } from '../bills/RepeatingBills';
import { useTrades } from '../networth/queries';
import { FundingRow } from './funding';
import { TagPurchaseSheet } from './FundingSheet';
import { applyTagChanges } from './goal-tags';
import { SetAsideSheet } from './SetAside';
import { MonthlySheet, MoveSheet, TakeBackSheet, useHasTaggedPurchase, UseSheet } from './GoalSheets';
import { setAsideOf } from './goal-actions';
import { cardHistory, dayMonth, fundedWindow, type GoalCard, goalCard, historyDay, monthsLeftLabel, stageShares } from './goal-cards';
import { fundingCaption, fundingGroups, type FundingGroup, GOAL_SHARING_COPY, heroSegments, initialsLine, sharedWithLabel } from './goal-sharing';
import { InfoHeader } from './InfoHeader';
import { useDraws, useEarmarks, useGoalDues, useGoalHistory, useGoalPlans, useGoalShare, usePrivateCopy } from './queries';
import { type DueToast, MonthHistoryGroup } from './GoalDues';
import { monthlySubtitle } from './goal-due';
import { UndoToast } from '../../ui/UndoToast';
import { useAccounts } from '../../lib/queries';

export function GoalRoute() {
  const { goalId } = useParams({ from: '/goals/$goalId' });
  return <GoalPage goalId={goalId} />;
}

/**
 * Under the figure, what the goal is short and — when it was whole before it lent money — the days it stood whole,
 * said as a fact rather than a failure (spec §7.2). The figures are the readers' own; nothing is worked out here.
 */
function ShortNote({ card, stood }: { card: GoalCard; stood: ReturnType<typeof fundedWindow> }) {
  if (card.shortLines.length === 0) return null;
  const many = card.shortLines.length > 1;
  return (
    <>
      {card.shortLines.map((line) => (
        <span key={line.accountName} className="mt-[2px] block text-[var(--ph-warn)]">
          Short by <Money minor={line.shortMinor} currency={line.currency} />
          {many && ` in ${line.accountName}`}
        </span>
      ))}
      {stood && (
        <span className="mt-[2px] block text-[var(--ph-ink-3)]">
          <span className="block">
            {stood.from === null
              ? `Fully funded until ${dayMonth(stood.until)}`
              : stood.from === stood.until
                ? `Fully funded on ${dayMonth(stood.until)}`
                : `Fully funded ${dayMonth(stood.from)} – ${dayMonth(stood.until)}`}
          </span>
          <span className="block">
            <Money minor={stood.amountMinor} currency={stood.currency} /> went to {stood.description}. Put it back and the fund is complete again.
          </span>
        </span>
      )}
    </>
  );
}

/**
 * A goal on its own: the figure, its stages, what funds it and what has happened to it — everything the list
 * had no room for. The list is where goals are read as a set; this is where one is read on its own.
 */
export function GoalPage({ goalId }: { goalId: string }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const goBack = useBack('/goals');
  const [tagging, setTagging] = useState(false);
  const trades = useTrades().data ?? [];
  const today = isoDate();
  const summary = useGoalPlans(today);
  const earmarks = useEarmarks();
  const history = useGoalHistory().data ?? {};
  // A history line's key is its draw's id, so a borrow can be asked whether the goal was whole when it was taken.
  const wholeBorrows = new Set((useDraws().data ?? []).filter((draw) => draw.intent === 'borrow' && draw.wasWhole).map((draw) => draw.id));
  const [settingAside, setSettingAside] = useState(false);
  // The one sheet open from the round actions or the ⋯, if any.
  const [open, setOpen] = useState<'use' | 'monthly' | 'take-back' | 'move' | null>(null);
  const hasPurchase = useHasTaggedPurchase(goalId);
  const [error, setError] = useState<unknown>(null);
  const share = useGoalShare(goalId).data ?? null;
  const goalDue = (useGoalDues().data ?? []).find((row) => row.settings.goalId === goalId) ?? null;
  const accountRows = useAccounts().data ?? [];
  const [toast, setToast] = useState<DueToast | null>(null);

  const plans = summary.data?.plans ?? [];
  const plan = plans.find((row) => row.goalId === goalId);
  // A goal stopped being shared while a link to it was kept: this phone's private copy is the way on (C30).
  const copy = usePrivateCopy(goalId, !!summary.data && !plan).data ?? null;

  async function togglePaid(stageId: string, paid: boolean) {
    await setStagePaid(database, ws, stageId, paid ? null : today);
    await invalidate();
  }

  if (!summary.data) {
    return (
      <div className={SCREEN}>
        <ErrorBox error={summary.error} />
      </div>
    );
  }

  if (!plan) {
    // Archived, or a link kept from before it was: the way out is the list, not a dead end.
    return (
      <div className={SCREEN}>
        <PushedTitle title="Goal not here" back="Goals" backTo="/goals" />
        <InsetGroup footer={copy ? GOAL_SHARING_COPY.noLongerShared : 'It may have been archived. Its tagged purchases keep their history.'}>
          {copy && <InsetRow title={GOAL_SHARING_COPY.openCopy} to="/goals/$goalId" params={{ goalId: copy }} />}
          <InsetRow title="Back to Goals" to="/goals" />
        </InsetGroup>
      </div>
    );
  }

  const card = goalCard(plan, { me: share?.state === 'on' ? share.me : null, baseCurrency: ws.baseCurrency });
  const currency = plan.currency;
  const warn = card.statusTone === 'warn';
  const full = history[card.goalId] ?? [];
  const { stood } = cardHistory(full, (key) => wholeBorrows.has(key));
  // A goal of one payment has no Stages group, so its paid mark waits behind the ⋯.
  const only = card.stageLines.length === 1 ? card.stageLines[0]! : null;

  const held = setAsideOf(earmarks.data ?? [], goalId).length > 0;
  const others = plans.filter((row) => row.goalId !== goalId);
  const shared = share !== null && share.state === 'on';
  const leaves = shared && !share.isSharer;
  async function leave() {
    if (!window.confirm(GOAL_SHARING_COPY.leaveConfirm(card.name))) return;
    try {
      await leaveSharedGoal(database, ws, goalId);
      await invalidate();
      await navigate({ to: '/goals' });
    } catch (e) {
      setError(e);
    }
  }
  const menu: CornerAction[] = [
    { key: 'edit', label: 'Edit', glyph: <Pencil size={18} aria-hidden />, run: () => void navigate({ to: '/goals/$goalId/edit', params: { goalId } }) },
    ...(held ? [{ key: 'take-back', label: 'Take back', glyph: <HandCoins size={18} aria-hidden />, run: () => setOpen('take-back') }] : []),
    ...(others.length > 0 && (held || hasPurchase)
      ? [{ key: 'move', label: 'Move to another goal', glyph: <ArrowRightLeft size={18} aria-hidden />, run: () => setOpen('move') }]
      : []),
    ...(only && card.kind !== 'emergency'
      ? [
          only.state === 'paid'
            ? { key: 'unpaid', label: 'Mark not paid', glyph: <Undo2 size={18} aria-hidden />, run: () => void togglePaid(only.stageId, true) }
            : { key: 'paid', label: 'Mark paid', glyph: <Check size={18} aria-hidden />, run: () => void togglePaid(only.stageId, false) },
        ]
      : []),
    ...(leaves ? [{ key: 'leave', label: GOAL_SHARING_COPY.leaveRow, glyph: <DoorOpen size={18} aria-hidden />, run: () => void leave() }] : []),
  ];
  const actions: CornerAction[] = [{ key: 'more', label: 'More', glyph: <MoreHorizontal size={20} aria-hidden />, menu }];

  // Set aside opens the form's set-aside part; tagging happens on a buy, retagged from its ⋮ on the holding's page,
  // so Tag a purchase opens the same list of buys as the form's Funding sheet and tags the pick at once. Use is there
  // only while something is set aside to use.
  const round: RoundAction[] = [
    { key: 'set-aside', label: 'Set aside', glyph: <PiggyBank size={20} aria-hidden />, run: () => setSettingAside(true) },
    { key: 'tag', label: 'Tag a purchase', glyph: <Tag size={20} aria-hidden />, run: () => setTagging(true) },
    ...(held ? [{ key: 'use', label: 'Use', glyph: <ShoppingBag size={20} aria-hidden />, run: () => setOpen('use') }] : []),
    { key: 'monthly', label: 'Monthly', glyph: <CalendarClock size={20} aria-hidden />, run: () => setOpen('monthly') },
  ];

  const shares = stageShares(card);
  const due = card.kind === 'emergency' ? null : card.targetMinor > 0 || !card.done ? card.dueLabel : null;
  // The three parts of the bar: what is marked paid, what is held, what is left. Held money never pushes past the whole.
  const paidShare = card.targetMinor > 0 ? Math.min(1, card.paidMinor / card.targetMinor) : 0;
  const savedShare = card.targetMinor > 0 ? Math.min(1 - paidShare, card.currentMinor / card.targetMinor) : 0;
  const toGoMinor = card.targetMinor > 0 ? Math.max(0, card.targetMinor - card.paidMinor - card.currentMinor) : 0;
  // A shared goal: one bar segment and one Funded-by group per member with money (C33); a private goal keeps its three parts.
  const otherMembers = share?.members.filter((member) => member.memberId !== share.me) ?? [];
  const groups: FundingGroup[] = shared ? fundingGroups(plan.links, otherMembers, share.me) : [];
  const meGroup: FundingGroup = groups.find((group) => group.memberId === null) ?? { memberId: null, label: 'Me', subtotalMinor: 0, links: [] };
  const sharedGroups = shared ? [meGroup, ...groups.filter((group) => group.memberId !== null)] : [];
  const MEMBER_COLOURS = ['var(--ph-tint)', '#af52de', '#ff9500', '#30b0c7'];
  const colourOf = (key: string, index: number) => (key === 'paid' ? 'var(--ph-ink-3)' : key === 'to-go' ? 'color-mix(in srgb, var(--ph-ink-3) 35%, transparent)' : key === 'me' ? (warn ? 'var(--ph-warn)' : 'var(--ph-up)') : MEMBER_COLOURS[index % MEMBER_COLOURS.length]!);
  const segments = shared ? heroSegments(card.paidMinor, groups, card.targetMinor).filter((segment) => segment.minor > 0) : [];
  const right = card.coverLabel ?? (card.monthsLeft !== null ? monthsLeftLabel(card.monthsLeft) : null);

  return (
    <div className={SCREEN} data-testid="goal-page">
      <PushedTitle title={card.name} back="Goals" onBack={goBack} actions={actions} />
      <ErrorBox error={summary.error ?? error} />

      {settingAside && <SetAsideSheet goal={plan.goal} earmarks={earmarks.data ?? []} onDone={() => setSettingAside(false)} />}

      {tagging && (
        <TagPurchaseSheet
          goalId={goalId}
          tagged={trades.filter((trade) => trade.goalId === goalId).map((trade) => trade.id)}
          onPickMany={(tradeIds) => void applyTagChanges((tradeId, to) => retagTrade(database, ws, tradeId, to), goalId, { tag: tradeIds, untag: [] }).then(({ failed }) => { invalidate(); if (failed.length > 0) setError(new Error(failed[0]!.message)); })}
          onClose={() => setTagging(false)}
        />
      )}
      {open === 'use' && <UseSheet plan={plan} earmarks={earmarks.data ?? []} onClose={() => setOpen(null)} />}
      {open === 'monthly' && <MonthlySheet plan={plan} onClose={() => setOpen(null)} />}
      {open === 'take-back' && <TakeBackSheet plan={plan} earmarks={earmarks.data ?? []} onClose={() => setOpen(null)} />}
      {open === 'move' && <MoveSheet plan={plan} others={others} earmarks={earmarks.data ?? []} onClose={() => setOpen(null)} />}

      <Panel wide className="space-y-3" testId="goal-card">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">{card.name}</p>
          <span data-testid="goal-status" className={'shrink-0 text-[13px] leading-[18px] font-medium ' + (warn ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-up-ink)]')}>
            {card.statusLabel}
          </span>
        </div>
        {shared && share && (
          <div className="flex items-center justify-between gap-3 text-[13px] leading-[18px] text-[var(--ph-ink-3)]" data-testid="goal-shared-with">
            <span className="min-w-0 truncate">{sharedWithLabel(otherMembers, share.bookName)}</span>
            <span className="flex shrink-0 -space-x-1" aria-hidden>
              {initialsLine(share.members.map((member) => member.name)).map((initials, index) => (
                <span key={index} className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[var(--ph-fill)] px-[4px] text-[10.5px] font-semibold text-[var(--ph-ink-2)] ring-2 ring-[var(--ph-surface)]">
                  {initials}
                </span>
              ))}
            </span>
          </div>
        )}
        <div>
          <p className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]" data-testid="goal-target">
            {formatMinor(card.targetMinor > 0 ? card.targetMinor : card.currentMinor, currency)}
          </p>
          {(due || right) && (
            <div className="flex items-baseline justify-between gap-3 text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
              {/* An emergency fund has no due date: its cover then stands where the date would, under the figure, as drawn. */}
              <span>{due ?? right}</span>
              {due && right && <span className="shrink-0">{right}</span>}
            </div>
          )}
        </div>
        {/* One bar, left to right: paid, then saved, then what is to go. Saving more than is asked fills it, never past. */}
        <UseBar
          share={card.done ? 1 : Math.min(1, card.progressPercent / 100)}
          height={6}
          warn={warn}
          label={`${card.name} progress`}
          segments={
            shared && card.targetMinor > 0
              ? segments.filter((segment) => segment.key !== 'to-go').map((segment, index) => ({ share: Math.min(1, segment.minor / card.targetMinor), colour: colourOf(segment.key, index) }))
              : card.targetMinor > 0
              ? [
                  { share: paidShare, colour: 'var(--ph-ink-3)' },
                  { share: savedShare, colour: warn ? 'var(--ph-warn)' : 'var(--ph-up)' },
                ]
              : undefined
          }
        />
        <ul className="flex flex-col text-[12.5px] leading-[26px] text-[var(--ph-ink-3)]">
          {shared &&
            segments.map((segment, index) => <KeyItem key={segment.key} colour={colourOf(segment.key, index)} label={segment.label} minor={segment.minor} currency={currency} testId={`goal-seg-${segment.key}`} />)}
          {!shared && card.paidMinor > 0 && <KeyItem colour="var(--ph-ink-3)" label="Paid" minor={card.paidMinor} currency={currency} testId="goal-paid" />}
          {!shared && <KeyItem colour={warn ? 'var(--ph-warn)' : 'var(--ph-up)'} label="Saved" minor={card.currentMinor} currency={currency} testId="goal-saved" />}
          {!shared && toGoMinor > 0 && <KeyItem colour="color-mix(in srgb, var(--ph-ink-3) 35%, transparent)" label="To go" minor={toGoMinor} currency={currency} testId="goal-togo" />}
        </ul>
        {card.shortLines.length > 0 && (
          <p className="text-[13px] leading-[18px]">
            <ShortNote card={card} stood={stood} />
          </p>
        )}
      </Panel>

      <ActionButtons actions={round} />

      {card.stageLines.length > 1 && (
        <InsetGroup wide header="Stages">
          {card.stageLines.map((line, index) => (
            /* Read-only: a payment is marked paid in Edit goal, on its own sheet. */
            <InsetRow
              key={line.stageId}
              testId="stage-line"
              title={`${line.when} · ${line.name}`}
              subtitle={
                <span className="mt-[4px] block">
                  <UseBar share={shares[index]!} />
                </span>
              }
              value={
                <span className="block text-right">
                  <Money minor={line.targetMinor} currency={currency} />
                  <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
                    {formatMinor(line.todayMinor, currency)} today · {line.stateLabel}
                  </span>
                </span>
              }
              valueTone="ink"
              chevron={false}
            />
          ))}
        </InsetGroup>
      )}

      {/* A goal that needs nothing more a month has nothing to plan: the box is for the ones still short of it. */}
      {plan.status !== 'funded' && !card.done && (
      <InsetGroup wide header="Each month">
        <InsetRow title="Needed a month" value={<Money minor={card.neededMonthlyMinor} currency={currency} />} valueTone="ink" chevron={false} />
        <InsetRow title="Set up a month" value={<Money minor={card.plannedMonthlyMinor} currency={currency} />} valueTone="ink" chevron={false} />
        <InsetRow
          title={card.differenceMinor < 0 ? 'Short by' : 'Room'}
          value={<Money minor={Math.abs(card.differenceMinor)} currency={currency} tone="none" />}
          valueTone={card.differenceMinor < 0 ? 'warn' : 'ink'}
          chevron={false}
        />
      </InsetGroup>
      )}

      {/* Due each month (screen 4): the Monthly row says when and where, and the months so far, newest first. */}
      {goalDue?.settings.active && (
        <InsetGroup wide>
          <InsetRow
            title="Monthly"
            subtitle={monthlySubtitle(goalDue.settings, (id) => accountRows.find((account) => account.id === id)?.name ?? 'Account') ?? undefined}
            value={<Money minor={plan.goal.standingMonthlyMinor} currency={currency} />}
            valueTone="ink"
            onClick={() => setOpen('monthly')}
            testId="goal-monthly-row"
          />
        </InsetGroup>
      )}
      {goalDue && <MonthHistoryGroup goal={{ goalId, name: card.name, currency }} months={goalDue.months} onToast={setToast} />}

      <section className="w-full">
        <InfoHeader
          title="Funded by"
          info={
            plan.goal.standingNote ? (
              <>
                {plan.goal.standingNote}, <Money minor={plan.goal.standingMonthlyMinor} currency={currency} />
              </>
            ) : undefined
          }
        />
        {shared ? (
          sharedGroups.map((group) => (
            <InsetGroup key={group.memberId ?? 'me'} wide header={group.label} trailing={<Money minor={group.subtotalMinor} currency={currency} />}>
              {group.links.map((link) => (
                <FundingRow key={`${link.accountId}-${link.kind}-${link.owner ?? 'me'}`} link={link} goalCurrency={plan.currency} caption={fundingCaption(link, group.label, share?.me)} />
              ))}
              {group.memberId === null && <InsetRow key="set-aside" title={<span className="text-[var(--ph-tint)]">{GOAL_SHARING_COPY.setAsideRow}</span>} chevron={false} onClick={() => setSettingAside(true)} />}
            </InsetGroup>
          ))
        ) : (
        <InsetGroup wide>
          {plan.links.length === 0 ? (
            <InsetRow title="Nothing yet" subtitle="Tag a purchase or set money aside." chevron={false} />
          ) : (
            plan.links.map((link) => <FundingRow key={`${link.accountId}-${link.kind}`} link={link} goalCurrency={plan.currency} />)
          )}
        </InsetGroup>
        )}
      </section>

      {card.riskWarning && <p className="mb-[10px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]">{card.riskWarning}</p>}
      {/* The short part of the old warning is said under the figure and on the Funded-by row; only the no-rate sentence is left. */}
      {plan.unconvertedWarning && <p className="mb-[10px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]">{plan.unconvertedWarning}</p>}

      {full.length > 0 && (
        <InsetGroup wide>
          <InsetRow
            title="History"
            value={`${full.length} ${full.length === 1 ? 'entry' : 'entries'}`}
            onClick={() => void navigate({ to: '/goals/$goalId/history', params: { goalId } })}
          />
        </InsetGroup>
      )}

      {toast && (
        <UndoToast
          icon={toast.icon}
          text={toast.text}
          onUndo={() => {
            const t = toast;
            setToast(null);
            void t.undo().catch(setError).finally(() => void invalidate());
          }}
          onDone={() => setToast(null)}
        />
      )}
    </div>
  );
}
