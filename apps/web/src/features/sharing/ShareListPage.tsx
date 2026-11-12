import {
  type CreatedInvite,
  confirmReview,
  getJointAccount,
  goalShareOf,
  markShareListAsked,
  type SharingDetail,
  setJointAccount,
  setShareSetting,
  shareGoal,
  shareListAskedFor,
  stopSharingGoal,
} from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { errorMessage, ErrorBox, cx } from '../../ui';
import { GROUP_HEADER_CLASS, InsetGroup, InsetRow, PushedTitle, SCREEN, SelectCircle } from '../../ui/native';
import { useInvalidateAll } from '../../lib/queries';
import { useEvents } from '../events/queries';
import { freshShare, type ShareProgress } from '../events/share-event';
import { useShareEventNow } from '../events/share-event-now';
import { useSharedEventSummaries } from '../events/shared-queries';
import { GOAL_SHARING_COPY } from '../goals/goal-sharing';
import { useGoalPlans, useGoals, useGoalShareTargets } from '../goals/queries';
import { InviteCard } from './InviteCard';
import { useActiveNetWorthGroup, useNetWorthGroup, useReview } from './net-worth-queries';
import { needsReview, netWorthRowOf, netWorthValue, sayNetWorthError } from './net-worth-state';
import { useSharingDetail } from './queries';
import {
  applyShareChanges,
  changesOf,
  draftOf,
  jointOn,
  keepConfirmed,
  type ShareDraft,
  type ShareList,
  type ShareListGroup,
  type ShareListItem,
  type ShareOutcome,
  SHARE_LIST_COPY,
  shareListOf,
  tickAll,
  tickedCount,
  toggle,
  toggleJoint,
} from './share-list';
import { useShareBook } from './share-hooks';
import { sayError } from './sharing-copy';

/*
 * One list to choose what to share with the household (2026-11-12): offered once as the last step of setting up
 * sharing (`ShareListSetupPage`, "Share N items" / Later), and kept on the Share page as "What’s shared with Andi"
 * (`ShareListPage`, ✓ to save). Every tick runs through the action its item's own page uses; nothing new is written.
 */

/** The members of the workspace who have joined it from a phone, other than this one's. */
export function joinedOthers(detail: SharingDetail) {
  return detail.members.filter((member) => !member.me && member.devices.length > 0);
}

/** Whether the set-up step is still owed on this phone: someone joined whom the list was not yet offered for. */
export function useShareListAsked(bookId: string) {
  const { database } = useApp();
  return useQuery({ queryKey: ['share-list-asked', bookId], queryFn: () => shareListAskedFor(database, bookId) });
}

/** Everything the list is made of, read whole and read again after every sync run. */
export function useShareList(bookId: string): { list: ShareList | null; goalShares: Record<string, Awaited<ReturnType<typeof goalShareOf>>> } {
  const { database, sync } = useApp();
  const queryClient = useQueryClient();
  useEffect(
    () =>
      sync.subscribe(() => {
        void queryClient.invalidateQueries({ queryKey: ['share-list'] });
        // A partner's phone and its version reach this one with a sync: a goal may be shareable now.
        void queryClient.invalidateQueries({ queryKey: ['goal-share-targets'] });
      }),
    [sync, queryClient],
  );
  const group = useActiveNetWorthGroup();
  const review = useReview();
  const goals = useGoals();
  const targets = useGoalShareTargets();
  const events = useEvents();
  const summaries = useSharedEventSummaries();
  const accountIds = (review.data?.items ?? []).map((item) => item.accountId);
  const joint = useQuery({
    queryKey: ['share-list', 'joint', accountIds],
    enabled: review.isSuccess,
    queryFn: async () => {
      const on = new Set<string>();
      for (const id of accountIds) if (await getJointAccount(database, id)) on.add(id);
      return on;
    },
  });
  const goalIds = (goals.data ?? []).map((goal) => goal.id);
  const shares = useQuery({
    queryKey: ['share-list', 'goal-shares', goalIds],
    enabled: goals.isSuccess,
    queryFn: async () => Object.fromEntries(await Promise.all(goalIds.map(async (id) => [id, await goalShareOf(database, id)] as const))),
  });
  const ready = group.isSuccess && review.isSuccess && goals.isSuccess && targets.isSuccess && events.isSuccess && summaries.isSuccess && joint.isSuccess && shares.isSuccess;
  const list = useMemo(() => {
    if (!ready) return null;
    const g = group.data;
    const r = review.data!;
    const items = r.items;
    const netWorth =
      g && g.workspaceBookId === bookId
        ? {
            mode: g.mode,
            reviewing: needsReview({ mode: g.mode, reviewed: r.reviewed, unreviewedItems: items.filter((item) => item.setting === null).length, pendingHidden: r.pending.length }),
            items,
            joint: joint.data!,
          }
        : null;
    return shareListOf({
      bookId,
      netWorth,
      goals: goals.data!.filter((goal) => goal.status !== 'archived').map((goal) => ({ id: goal.id, name: goal.name, share: shares.data![goal.id] ?? null })),
      goalTargets: targets.data!,
      events: events.data!.map((event) => ({ id: event.id, name: event.name, startsOn: event.startsOn, shared: summaries.data![event.id] !== undefined })),
    });
  }, [ready, group.data, review.data, joint.data, goals.data, shares.data, targets.data, events.data, summaries.data, bookId]);
  return { list, goalShares: shares.data ?? {} };
}

/** Share › What’s shared with Andi. */
export function ShareListPage() {
  const { bookId } = useParams({ from: '/account/workspaces/$bookId/share/what' });
  return <ShareListScreen bookId={bookId} setup={false} />;
}

/** The last step of setting up sharing: the same list, with Share N items and Later. */
export function ShareListSetupPage() {
  const { bookId } = useParams({ from: '/account/workspaces/$bookId/share/what/start' });
  return <ShareListScreen bookId={bookId} setup />;
}

function ShareListScreen({ bookId, setup }: { bookId: string; setup: boolean }) {
  const book = useShareBook(bookId);
  const detail = useSharingDetail(bookId);
  if (book === undefined || detail.isPending) return <div className={SCREEN} />;
  if (!book || !detail.data) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Share" back="Share" backTo="/account/workspaces/$bookId/share" backParams={{ bookId }} />
        <InsetGroup wide>
          <InsetRow title="That workspace is not shared." chevron={false} />
        </InsetGroup>
      </div>
    );
  }
  return <ShareListBody bookId={bookId} bookName={book.name} detail={detail.data} setup={setup} />;
}

function ShareListBody({ bookId, bookName, detail, setup }: { bookId: string; bookName: string; detail: SharingDetail; setup: boolean }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const queryClient = useQueryClient();
  const shareEventNow = useShareEventNow();
  const plans = useGoalPlans();
  const nwGroup = useNetWorthGroup(bookId);
  const { list, goalShares } = useShareList(bookId);
  const eventRows = useEvents().data ?? [];
  const [draft, setDraft] = useState<ShareDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<ShareOutcome<CreatedInvite> | null>(null);
  // Each event's share is kept across a retry (`runShare`): one failed after its book was made carries on from there.
  const progress = useRef(new Map<string, ShareProgress>());
  const me = detail.members.find((member) => member.me) ?? null;
  const others = joinedOthers(detail).map((member) => member.name);
  const othersAll = others.length > 0 ? others : detail.members.filter((member) => !member.me).map((member) => member.name);

  // The draft starts from what is shared now, once the list is read.
  useEffect(() => {
    if (list && draft === null) setDraft(draftOf(list));
  }, [list, draft]);

  const backToShare = () => navigate({ to: '/account/workspaces/$bookId/share', params: { bookId } });

  async function markAsked() {
    await markShareListAsked(database, bookId, joinedOthers(detail).map((member) => member.memberId));
    // Written into the cache too, not only marked stale: the Share page reads it as it mounts, before any refetch.
    queryClient.setQueryData(['share-list-asked', bookId], await shareListAskedFor(database, bookId));
  }

  async function later() {
    if (busy) return;
    setBusy(true);
    try {
      await markAsked();
      await backToShare();
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  /** A goal turned off asks first, as its own page asks (final review M1): a copy only for those with money in it. */
  function confirmStop(goalId: string): boolean {
    const share = goalShares[goalId];
    const goalName = list?.groups.find((group) => group.key === 'goals')?.items.find((item) => item.id === goalId)?.name ?? '';
    const members = (share?.members ?? []).filter((member) => member.memberId !== share?.me);
    const plan = plans.data?.plans.find((row) => row.goalId === goalId);
    const funders = new Set((plan?.links ?? []).map((link) => link.owner).filter((owner): owner is string => owner !== undefined));
    return window.confirm(
      GOAL_SHARING_COPY.stopConfirm(
        goalName,
        members.map((member) => member.name),
        members.filter((member) => funders.has(member.memberId)).map((member) => member.name),
      ),
    );
  }

  async function apply() {
    if (!list || !draft || busy) return;
    const changes = keepConfirmed(changesOf(list, draft), confirmStop);
    setBusy(true);
    setError(null);
    try {
      // Answered: the step is not offered again, whatever goes through below.
      if (setup) await markAsked();
      const result = await applyShareChanges<CreatedInvite>(
        changes,
        {
          review: (settings) => confirmReview(database, ws, settings),
          setting: (accountId, setting) => setShareSetting(database, accountId, setting),
          joint: (accountId, on) => setJointAccount(database, accountId, on),
          shareGoal: (goalId) => shareGoal(database, ws, goalId, bookId),
          stopGoal: (goalId) => stopSharingGoal(database, ws, goalId),
          shareEvent: async (eventId) => {
            const event = eventRows.find((row) => row.id === eventId);
            const run = progress.current.get(eventId) ?? freshShare();
            progress.current.set(eventId, run);
            const done = await shareEventNow({ eventId, personName: me?.name ?? '', currency: event?.currency ?? ws.baseCurrency }, run);
            if (!done) throw new Error('Already being shared. Try again in a moment.');
            return done.invite;
          },
        },
        (failure) => errorMessage(sayError(sayNetWorthError(failure))),
      );
      await invalidate();
      setDraft(null);
      if (result.failed.length > 0 || result.invites.length > 0) setOutcome(result);
      else await backToShare();
    } catch (failure) {
      setError(sayError(failure));
    } finally {
      setBusy(false);
    }
  }

  const count = list && draft ? tickedCount(list, draft) : 0;
  const changed = list && draft ? changesOf(list, draft).length > 0 : false;
  const title = setup ? SHARE_LIST_COPY.setupTitle(othersAll, bookName) : SHARE_LIST_COPY.title(othersAll, bookName);

  if (outcome) {
    return (
      <div className={SCREEN} data-testid="share-list-outcome">
        <PushedTitle title={title} back="Share" backTo="/account/workspaces/$bookId/share" backParams={{ bookId }} />
        {outcome.failed.length > 0 ? (
          <InsetGroup wide header={SHARE_LIST_COPY.failedHeader}>
            {outcome.failed.map((failed) => (
              <InsetRow key={failed.name} testId="share-list-failed" title={failed.name} subtitle={failed.reason} chevron={false} />
            ))}
          </InsetGroup>
        ) : null}
        {outcome.invites.map((shared) => (
          <InviteCard
            key={shared.eventId}
            invite={shared.invite}
            kind="event"
            bookName={shared.name}
            inviterName={me?.name ?? ''}
            header={`Invite to ${shared.name}`}
            footer={SHARE_LIST_COPY.invitesFooter(othersAll, bookName)}
          />
        ))}
        <InsetGroup wide>
          <InsetRow testId="share-list-done" title="Done" action onClick={() => void backToShare()} />
        </InsetGroup>
      </div>
    );
  }

  const netWorthOff = list !== null && list.netWorth === null && nwGroup.isSuccess;

  return (
    <div className={SCREEN} data-testid={setup ? 'share-list-setup' : 'share-list'}>
      {setup ? (
        <header className="mb-[10px] pt-[6px]">
          <p className="text-center text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{SHARE_LIST_COPY.step}</p>
          <h1 className="mt-[6px] px-[4px] text-[28px] leading-[34px] font-bold text-[var(--ph-ink)]">{title}</h1>
        </header>
      ) : (
        <PushedTitle
          title={title}
          back="Share"
          backTo="/account/workspaces/$bookId/share"
          backParams={{ bookId }}
          actions={[{ key: 'save', label: 'Save', glyph: <Check size={20} aria-hidden />, disabled: busy || !changed, run: () => void apply() }]}
        />
      )}
      <p className="mb-[14px] px-[4px] text-[13px] leading-[18px] text-[var(--ph-ink-3)]">{SHARE_LIST_COPY.lede(othersAll, bookName)}</p>
      <ErrorBox error={error} />
      {list && draft ? (
        <>
          {netWorthOff ? (
            <InsetGroup wide header="Accounts & cards" footer={SHARE_LIST_COPY.netWorthOff}>
              <InsetRow
                testId="share-list-net-worth"
                title="Net worth"
                value={netWorthValue(netWorthRowOf(nwGroup.data, detail.members))}
                to="/account/workspaces/$bookId/share/net-worth"
                params={{ bookId }}
              />
            </InsetGroup>
          ) : null}
          {list.groups.map((group) => (
            <TickGroup
              key={group.key}
              group={group}
              draft={draft}
              disabled={busy}
              footer={groupFooter(group, othersAll, bookName)}
              onTickAll={() => setDraft(tickAll(draft, group))}
              onToggle={(item) => setDraft(toggle(draft, item))}
              onJoint={(item) => setDraft(toggleJoint(draft, item))}
            />
          ))}
        </>
      ) : null}
      {setup ? (
        <div className="sticky bottom-0 -mx-4 mt-[10px] bg-gradient-to-b from-transparent to-[var(--ph-bg)] px-4 pt-[18px] pb-[calc(16px+env(safe-area-inset-bottom))]" style={{ backgroundImage: 'linear-gradient(transparent, var(--ph-bg) 22%)' }}>
          <button
            type="button"
            data-testid="share-list-share"
            disabled={busy || count === 0}
            onClick={() => void apply()}
            className="ph-focus w-full rounded-[13px] bg-[var(--ph-tint)] p-[13px] text-center text-[16px] font-semibold text-[var(--ph-surface)] disabled:opacity-40"
          >
            {busy ? 'Sharing…' : SHARE_LIST_COPY.shareButton(count)}
          </button>
          <button type="button" data-testid="share-list-later" disabled={busy} onClick={() => void later()} className="ph-focus w-full p-[11px] text-center text-[15.5px] text-[var(--ph-tint)] disabled:opacity-40">
            {SHARE_LIST_COPY.later}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The sentence under a group: what a tick means for accounts, and why a tick cannot be taken off where one cannot. */
function groupFooter(group: ShareListGroup, others: readonly string[], bookName: string): string | undefined {
  const reasons = [...new Set(group.items.map((item) => item.locked).filter((reason): reason is string => reason !== null))];
  const lines = [group.key === 'accounts' ? SHARE_LIST_COPY.accountsFooter(others, bookName) : null, ...reasons].filter((line): line is string => line !== null);
  return lines.length > 0 ? lines.join(' ') : undefined;
}

function TickGroup({
  group,
  draft,
  disabled,
  footer,
  onTickAll,
  onToggle,
  onJoint,
}: {
  group: ShareListGroup;
  draft: ShareDraft;
  disabled: boolean;
  footer?: string;
  onTickAll: () => void;
  onToggle: (item: ShareListItem) => void;
  onJoint: (item: ShareListItem) => void;
}) {
  const allTicked = group.items.every((item) => draft.ticked.has(item.key));
  return (
    <section className="w-full md:max-w-2xl" style={{ marginBottom: 22 }} data-testid={`share-list-${group.key}`}>
      <div className="flex items-baseline justify-between gap-3 px-[4px] pb-[6px]">
        <h2 className={GROUP_HEADER_CLASS}>{group.label}</h2>
        <button
          type="button"
          disabled={disabled || allTicked}
          onClick={onTickAll}
          aria-label={`Tick all ${group.label}`}
          className="ph-focus text-[13px] leading-[16px] text-[var(--ph-tint)] disabled:opacity-40"
        >
          {SHARE_LIST_COPY.tickAll}
        </button>
      </div>
      <div className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
        {group.items.map((item) => {
          const ticked = draft.ticked.has(item.key);
          const fixed = ticked && item.locked !== null;
          const joint = jointOn(draft, item);
          return (
            <div key={item.key} className="flex items-center pr-[13px]" data-testid="share-list-row">
              <button
                type="button"
                role="checkbox"
                aria-checked={ticked}
                aria-label={item.name}
                aria-disabled={fixed || undefined}
                disabled={disabled}
                onClick={() => !fixed && onToggle(item)}
                className={cx('ph-focus-inset flex min-h-[46px] min-w-0 flex-1 items-center gap-[10px] pl-[13px] text-left active:bg-[var(--ph-fill)]', fixed && 'cursor-default')}
              >
                <SelectCircle picked={ticked} className={cx('h-[22px] w-[22px]', fixed && 'opacity-50')} />
                <span className="min-w-0 flex-1 truncate text-[16px] text-[var(--ph-ink)]">{item.name}</span>
                {item.meta ? <span className="shrink-0 whitespace-nowrap text-[12.5px] text-[var(--ph-ink-3)]">{item.meta}</span> : null}
              </button>
              {item.canJoint && ticked ? (
                <button
                  type="button"
                  aria-pressed={joint}
                  aria-label={`Joint, ${item.name}`}
                  disabled={disabled}
                  onClick={() => onJoint(item)}
                  className={cx(
                    'ph-focus ml-[8px] shrink-0 rounded-[11px] border px-[9px] py-[3px] text-[12px] whitespace-nowrap',
                    joint ? 'border-[var(--ph-tint)] bg-[var(--ph-fill)] font-semibold text-[var(--ph-tint)]' : 'border-[var(--ph-chevron)] text-[var(--ph-ink-2)]',
                  )}
                >
                  {SHARE_LIST_COPY.joint}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {footer ? <p className="px-[4px] pt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{footer}</p> : null}
    </section>
  );
}
