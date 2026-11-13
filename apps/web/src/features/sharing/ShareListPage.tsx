import {
  activeNetWorthGroup,
  planEventCopyDelete,
  type SharedEventView,
  type CreatedInvite,
  confirmReview,
  getJointAccount,
  goalShareOf,
  markShareListAsked,
  type MoveRefusal,
  ownSentAccountIds,
  reviewedFor,
  reviewItems,
  seedShareListAsked,
  type SharingDetail,
  setJointAccount,
  setShareSetting,
  shareGoal,
  shareListAskedFor,
  stopSharingGoal,
} from '@expanses/db';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { CalendarDays, Check, CreditCard, Lock, type LucideIcon, Target } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { errorMessage, ErrorBox, cx } from '../../ui';
import { ToastCard, UndoToast } from '../../ui/UndoToast';
import { GROUP_HEADER_CLASS, InsetGroup, InsetRow, Notice, OWNED_TOGETHER, PushedTitle, RowIcon, SCREEN } from '../../ui/native';
import { useInvalidateAll } from '../../lib/queries';
import { useEvents } from '../events/queries';
import { freshShare, type ShareProgress } from '../events/share-event';
import { useShareEventNow } from '../events/share-event-now';
import { useSharedEventSummaries, useSharedEventView } from '../events/shared-queries';
import { pageLocks } from '../events/shared-view';
import { DELETE_COPY_LABEL, deleteEventCopyFlow } from '../events/delete-copy';
import { ShareEventSheet } from '../events/ShareEventSheet';
import { useSafetyCopy } from '../workspaces/safety-copy';
import { GOAL_SHARING_COPY } from '../goals/goal-sharing';
import { useGoalPlans, useGoals, useGoalShareTargets } from '../goals/queries';
import { assetKindTile, debtKindTile } from '../ownables/catalogue-view';
import { InviteCard } from './InviteCard';
import { startNetWorth } from './household';
import { JOINT_SHARED_LINE, namesOf, sayNetWorthError } from './net-worth-state';
import { useSharingDetail } from './queries';
import {
  applyShareChanges,
  changesOf,
  completeReviewSettings,
  emptyDraft,
  eventsToShare,
  isTicked,
  jointLineGroup,
  jointOn,
  keepConfirmed,
  NET_WORTH_CHANGED,
  type NetWorthInput,
  type OffConfirm,
  offConfirmOf,
  reconcile,
  reviewStillShown,
  type ShareDraft,
  type ShareList,
  type ShareListGroup,
  type ShareListItem,
  type ShareOutcome,
  SHARE_LIST_COPY,
  shareListOf,
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

/**
 * Whom the set-up step was already offered for, on this phone. The first run of this build marks every member already
 * joined first (`seedShareListAsked`), so a household sharing since before gets the Share page row and no redirect.
 */
export function useShareListAsked(bookId: string) {
  const { database } = useApp();
  return useQuery({
    queryKey: ['share-list-asked', bookId],
    queryFn: async () => {
      // Accepted risk (failure path only): reached first only when the App's seed failed, a member who joined in between counts as offered.
      await seedShareListAsked(database);
      return shareListAskedFor(database, bookId);
    },
  });
}

/** What an event's share from the list brings back: its invite, and what stayed where it was. */
interface EventShared {
  invite: CreatedInvite;
  kept: MoveRefusal[];
}

/** Everything the list is made of, read whole and read again after every sync run. */
export function useShareList(bookId: string): { list: ShareList | null; goalShares: Record<string, Awaited<ReturnType<typeof goalShareOf>>> } {
  const { database, sync, ws } = useApp();
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
  // Net worth as one snapshot (fix round 2): the group, its proposal, the review, the items, what is live in the log
  // and what is joint are read together, so a Save never answers a review the list did not show. The previous read is
  // kept while a new one runs, so the list never blanks.
  const netWorth = useQuery({
    queryKey: ['share-list', 'net-worth', ws.workspaceId, bookId],
    // The previous read stands in only for the same workspace: another one's never shows here (round 3).
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[3] === bookId ? previous : undefined),
    queryFn: async (): Promise<NetWorthInput | null> => {
      const g = await activeNetWorthGroup(database);
      // Net worth shared in another workspace: nothing of it is switched here.
      if (g && g.workspaceBookId !== bookId) return null;
      const items = await reviewItems(database, ws);
      const joint = new Set<string>();
      for (const item of items) if (await getJointAccount(database, item.accountId)) joint.add(item.accountId);
      if (g) {
        return {
          stage: 'active',
          mode: g.mode,
          proposalId: g.proposalId,
          reviewed: await reviewedFor(database, g.groupBookId, g.proposalId),
          items,
          joint,
          live: new Set(await ownSentAccountIds(database, g.groupBookId)),
        };
      }
      // No active group (2026-11-13): the accounts are listed all the same. Started from here and waiting for the other
      // phone, what is stored is what was switched on; not started, nothing is shared and the first switch starts it.
      const view = await sync.netWorthGroup(bookId);
      const pending = view?.pending && !view.pending.cancelled && view.pending.members.includes(view.me) ? view.pending : null;
      // One tax ID asked of this phone: answered in the tax report first.
      if (pending && pending.mode === 'joint' && view!.waitingFor.includes(view!.me)) return null;
      return { stage: pending ? 'waiting' : 'none', mode: 'separate', proposalId: pending?.proposalId ?? '', reviewed: false, items, joint, live: new Set() };
    },
  });
  const goals = useGoals();
  const targets = useGoalShareTargets();
  const events = useEvents();
  const summaries = useSharedEventSummaries();
  const goalIds = (goals.data ?? []).map((goal) => goal.id);
  const shares = useQuery({
    queryKey: ['share-list', 'goal-shares', goalIds],
    enabled: goals.isSuccess,
    placeholderData: keepPreviousData,
    queryFn: async () => Object.fromEntries(await Promise.all(goalIds.map(async (id) => [id, await goalShareOf(database, id)] as const))),
  });
  const ready = netWorth.isSuccess && goals.isSuccess && targets.isSuccess && events.isSuccess && summaries.isSuccess && shares.isSuccess;
  const list = useMemo(() => {
    if (!ready) return null;
    return shareListOf({
      bookId,
      netWorth: netWorth.data ?? null,
      // A goal whose link is not read yet is left out until it is (round 3): never offered as unshared by guess.
      goals: goals.data!
        .filter((goal) => goal.status !== 'archived' && goal.id in shares.data!)
        .map((goal) => ({ id: goal.id, name: goal.name, share: shares.data![goal.id] ?? null })),
      goalTargets: targets.data!,
      events: events.data!.map((event) => ({
        id: event.id,
        name: event.name,
        startsOn: event.startsOn,
        currency: event.currency ?? ws.baseCurrency,
        shared: summaries.data![event.id] !== undefined,
      })),
    });
  }, [ready, netWorth.data, goals.data, shares.data, targets.data, events.data, summaries.data, bookId, ws.baseCurrency]);
  return { list, goalShares: shares.data ?? {} };
}

/** Share › Shared with Andi. */
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
  // Keyed by the workspace: another one's list starts afresh, its edits and its kept reads with it (round 3).
  return <ShareListBody key={bookId} bookId={bookId} bookName={book.name} detail={detail.data} setup={setup} />;
}

/** The name this person shares an event under: theirs in the workspace; never an empty one. */
function personNameOf(detail: SharingDetail): string | null {
  const name = (detail.members.find((member) => member.me) ?? detail.members.find((member) => member.memberId === detail.memberId))?.name.trim();
  return name ? name : null;
}

function ShareListBody({ bookId, bookName, detail, setup }: { bookId: string; bookName: string; detail: SharingDetail; setup: boolean }) {
  const { database, sync, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const queryClient = useQueryClient();
  const shareEventNow = useShareEventNow();
  const plans = useGoalPlans();
  const { list, goalShares } = useShareList(bookId);
  const eventRows = useEvents().data ?? [];
  const [edits, setEdits] = useState<ShareDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<ShareOutcome<EventShared> | null>(null);
  const [assetsOpen, setAssetsOpen] = useState(false);
  // The short bar after an icon tap (mockup ①a): what changed, and the draft to go back to.
  const [undo, setUndo] = useState<{ text: string; before: ShareDraft } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  // Turning something off asks first (mockup ③): what is asked, and the draft it leads to.
  const [asking, setAsking] = useState<{ ask: OffConfirm; next: ShareDraft; undo: { text: string; before: ShareDraft } | null } | null>(null);
  // Each event's share is kept across a retry (`runShare`): one failed after its book was made carries on from there.
  const progress = useRef(new Map<string, ShareProgress>());
  const personName = personNameOf(detail);
  const others = joinedOthers(detail).map((member) => member.name);
  const othersAll = others.length > 0 ? others : detail.members.filter((member) => !member.me).map((member) => member.name);
  // The edits over the list as it is read now (fix round 1, 2): rows that came are as they stand, rows gone drop out.
  const draft = list ? reconcile(list, edits ?? emptyDraft(list)) : null;

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
    // Nothing switched: Done is Later.
    if (setup && changes.length === 0) return void later();
    setBusy(true);
    setError(null);
    try {
      // Answered: the step is not offered again, whatever goes through below.
      if (setup) await markAsked();
      const result = await applyShareChanges<EventShared>(
        changes,
        {
          // The first account switched on starts the household's net worth (2026-11-13), filed separately — refused when
          // a group came meanwhile (the reads after Save bring the list up to date). An item opened since the list was
          // read was never shown, so it is sent private.
          start: async (settings) => {
            const view = await sync.netWorthGroup(bookId);
            if ((await activeNetWorthGroup(database)) || (view?.pending && !view.pending.cancelled)) throw new Error(NET_WORTH_CHANGED);
            const ids = (await reviewItems(database, ws)).map((item) => item.accountId);
            await startNetWorth({ database, sync }, bookId, joinedOthers(detail).map((member) => member.memberId), completeReviewSettings(settings, ids));
          },
          // Made whole against the items as they are now (fix round 1, 4): one added since the list was read is sent
          // as hidden, never left to the review's own default of shared.
          review: async (settings) => {
            // The review on screen, still: the same proposal and filing, still waiting (fix round 2). Refused otherwise;
            // the reads after Save bring the list up to date.
            const shown = list.netWorth!;
            const g = await activeNetWorthGroup(database);
            const current = g && g.workspaceBookId === bookId ? g : null;
            const refusal = reviewStillShown(shown, {
              proposalId: current?.proposalId ?? null,
              mode: current?.mode ?? null,
              reviewed: current ? await reviewedFor(database, current.groupBookId, current.proposalId) : false,
            });
            if (refusal) throw new Error(refusal);
            const ids = (await reviewItems(database, ws)).map((item) => item.accountId);
            await confirmReview(database, ws, completeReviewSettings(settings, ids), { missing: 'hidden' });
          },
          setting: (accountId, setting) => setShareSetting(database, accountId, setting),
          joint: (accountId, on) => setJointAccount(database, accountId, on),
          shareGoal: (goalId) => shareGoal(database, ws, goalId, bookId),
          stopGoal: (goalId) => stopSharingGoal(database, ws, goalId),
          shareEvent: async (eventId) => {
            const event = eventRows.find((row) => row.id === eventId);
            if (!personName) throw new Error(SHARE_LIST_COPY.noName(event?.name ?? 'This event'));
            const run = progress.current.get(eventId) ?? freshShare();
            progress.current.set(eventId, run);
            const done = await shareEventNow({ eventId, personName, currency: event?.currency ?? ws.baseCurrency }, run);
            if (!done) throw new Error('Already being shared. Try again in a moment.');
            return done;
          },
        },
        (failure) => errorMessage(sayError(sayNetWorthError(failure))),
      );
      await invalidate();
      setEdits(null);
      setUndo(null);
      if (result.failed.length > 0 || result.events.length > 0) setOutcome(result);
      else await backToShare();
    } catch (failure) {
      setError(sayError(failure));
    } finally {
      setBusy(false);
    }
  }

  const changed = list && draft ? changesOf(list, draft).length > 0 : false;
  const title = SHARE_LIST_COPY.title(othersAll, bookName);

  if (outcome) {
    return (
      <div className={SCREEN} data-testid="share-list-outcome">
        <PushedTitle title={title} back="Share" backTo="/account/workspaces/$bookId/share" backParams={{ bookId }} />
        {outcome.failed.length > 0 ? (
          <InsetGroup wide header={SHARE_LIST_COPY.failedHeader}>
            {outcome.failed.map((failed) => (
              <InsetRow key={failed.key} testId="share-list-failed" title={failed.name} subtitle={failed.reason} chevron={false} />
            ))}
          </InsetGroup>
        ) : null}
        {outcome.events.map((event) => (
          <div key={event.eventId}>
            <InviteCard
              invite={event.shared.invite}
              kind="event"
              bookName={event.name}
              inviterName={personName ?? ''}
              header={`Invite to ${event.name}`}
              footer={SHARE_LIST_COPY.invitesFooter(othersAll, bookName)}
            />
            {event.shared.kept.length > 0 ? (
              <InsetGroup wide header={SHARE_LIST_COPY.keptHeader(event.name)}>
                {event.shared.kept.map((kept) => (
                  <InsetRow key={kept.transactionId} testId="share-list-kept" title={kept.why} chevron={false} />
                ))}
              </InsetGroup>
            ) : null}
          </div>
        ))}
        <InsetGroup wide>
          <InsetRow testId="share-list-done" title="Done" action onClick={() => void backToShare()} />
        </InsetGroup>
      </div>
    );
  }

  const netWorthOff = list !== null && list.netWorth === null;
  const reviewWaits = list?.netWorth && (list.netWorth.stage ?? 'active') === 'active' && !list.netWorth.reviewed && list.netWorth.mode === 'joint' && list.groups.some((group) => group.key === 'accounts' || group.key === 'assets') ? list.netWorth : null;

  /** A switch turned: off on something owned together asks first (once for both). */
  function onToggle(item: ShareListItem) {
    if (!list || !draft) return;
    const next = toggle(list, draft, item);
    const ask = offConfirmOf(list, draft, item, 'shared', othersAll);
    setHint(null);
    if (ask) setAsking({ ask, next, undo: null });
    else setEdits(next);
  }

  /** The icon tapped (mockup ①a): owned together on or off, with a short Undo bar; off asks first. */
  function onIcon(item: ShareListItem) {
    if (!list || !draft) return;
    if (!isTicked(draft, item)) {
      setUndo(null);
      setHint(SHARE_LIST_COPY.notShareableHint);
      return;
    }
    setHint(null);
    const next = toggleJoint(draft, item);
    const bar = { text: SHARE_LIST_COPY.undoLine(item.name, jointOn(next, item)), before: draft };
    const ask = offConfirmOf(list, draft, item, 'joint', othersAll);
    if (ask) setAsking({ ask, next, undo: bar });
    else {
      setEdits(next);
      setUndo(bar);
    }
  }

  const groupOf = (key: string) => list?.groups.find((group) => group.key === key) ?? null;
  const assets = groupOf('assets');
  const drawGroup = (group: ShareListGroup) => (
    <SwitchGroup
      key={group.key}
      topLine={list && jointLineGroup(list) === group.key ? <JointSharedLine /> : null}
      group={group}
      draft={draft!}
      disabled={busy}
      footer={groupFooter(group, othersAll, bookName, group.key === 'events' ? eventsToShare(list!, draft!).map((item) => item.name) : [])}
      onToggle={onToggle}
      onIcon={onIcon}
    />
  );

  return (
    <div className={SCREEN} data-testid={setup ? 'share-list-setup' : 'share-list'}>
      {setup ? (
        <header className="mb-[10px] pt-[6px]">
          <div className="flex items-center justify-between px-[4px]">
            <button type="button" data-testid="share-list-later" disabled={busy} onClick={() => void later()} className="ph-focus ph-tap text-[17px] leading-[22px] text-[var(--ph-tint)] disabled:opacity-40 md:text-[15px]">
              {SHARE_LIST_COPY.later}
            </button>
            <button type="button" data-testid="share-list-share" disabled={busy || !list} onClick={() => void apply()} className="ph-focus ph-tap text-[17px] leading-[22px] font-semibold text-[var(--ph-tint)] disabled:opacity-40 md:text-[15px]">
              {busy ? 'Sharing…' : SHARE_LIST_COPY.done}
            </button>
          </div>
          <p className="mt-[4px] text-center text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{SHARE_LIST_COPY.step}</p>
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
      <ErrorBox error={error} />
      <AlwaysShared bookName={bookName} />
      {list && draft ? (
        <>
          {netWorthOff ? (
            <InsetGroup wide header="Accounts & cards">
              <InsetRow testId="share-list-net-worth" title={SHARE_LIST_COPY.netWorthAsked} subtitle={undefined} to="/tax-report" />
            </InsetGroup>
          ) : null}
          {reviewWaits ? (
            <div className="mb-[14px]">
              <Notice kind="warning" testId="share-list-review" title={SHARE_LIST_COPY.reviewTitle} body={SHARE_LIST_COPY.reviewBody(reviewWaits.mode, othersAll, bookName)} />
            </div>
          ) : null}
          {list.groups.filter((group) => group.key !== 'assets').map((group) => (group.key === 'events' ? <EventsGroup key="events" group={group} onError={setError} /> : drawGroup(group)))}
          {assets ? (
            <>
              <InsetGroup wide>
                <InsetRow
                  testId="share-list-assets-row"
                  title={SHARE_LIST_COPY.assetsRow(assets.items.length)}
                  value={assetsOpen ? undefined : SHARE_LIST_COPY.rowValue(assets.items.filter((item) => isTicked(draft, item)).length)}
                  chevron={!assetsOpen}
                  onClick={() => setAssetsOpen((open) => !open)}
                />
              </InsetGroup>
              {assetsOpen ? drawGroup(assets) : null}
            </>
          ) : null}
        </>
      ) : null}
      {hint ? <ToastCard text={hint} data-testid="share-list-hint" /> : null}
      {undo && !hint ? (
        <UndoToast
          text={undo.text}
          testId="share-list-undo"
          onUndo={() => {
            setEdits(undo.before);
            setUndo(null);
          }}
          onDone={() => setUndo(null)}
        />
      ) : null}
      {asking ? (
        <Sheet
          title={asking.ask.title}
          onClose={() => setAsking(null)}
          confirm={{
            label: asking.ask.confirm,
            run: () => {
              setEdits(asking.next);
              setUndo(asking.undo);
              setAsking(null);
            },
          }}
        >
          <p data-testid="share-list-ask" className="text-[15px] leading-[20px]">
            {asking.ask.body}
          </p>
        </Sheet>
      ) : null}
    </div>
  );
}

/** One tax ID: why every net worth item reads Shared, said once above the first net worth group that has a fixed item. */
function JointSharedLine() {
  return (
    <p data-testid="share-list-joint-line" className="px-[4px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
      {JOINT_SHARED_LINE}{' '}
      <Link to="/tax-report" className="text-[var(--ph-tint)]">
        Change
      </Link>
    </p>
  );
}

/**
 * The sentence under a group: what Shared and owned together mean for accounts, why a switch cannot be turned off where
 * one cannot, and for each event switched on to be shared, what sharing it moves (the event Share sheet's own words).
 */
function groupFooter(group: ShareListGroup, others: readonly string[], bookName: string, eventsSharing: readonly string[]): string | undefined {
  const reasons = [...new Set(group.items.map((item) => item.locked).filter((reason): reason is string => reason !== null && reason !== JOINT_SHARED_LINE))];
  const lines = [
    group.key === 'accounts' ? SHARE_LIST_COPY.accountsFooter(others, bookName) : null,
    ...reasons,
    eventsSharing.length > 0 ? SHARE_LIST_COPY.eventsFooter(eventsSharing) : null,
  ].filter((line): line is string => line !== null);
  return lines.length > 0 ? lines.join(' ') : undefined;
}

/** The drawing a row's icon wears: the kind of account or asset, a goal's target, an event's calendar. */
function glyphOf(item: ShareListItem): LucideIcon {
  if (item.group === 'goals') return Target;
  if (item.group === 'events') return CalendarDays;
  if (item.subtype === 'credit_card') return CreditCard;
  if (item.group === 'accounts') return assetKindTile('liquid', item.subtype ?? '');
  return DEBT_SUBTYPES.has(item.subtype ?? '') ? debtKindTile(item.subtype ?? '') : assetKindTile('', item.subtype ?? '');
}

const DEBT_SUBTYPES = new Set(['loan', 'mortgage', 'vehicle_loan', 'online_loan', 'payable', 'other_loans', 'paylater', 'installment']);

function SwitchGroup({
  group,
  draft,
  disabled,
  footer,
  topLine,
  onToggle,
  onIcon,
}: {
  group: ShareListGroup;
  draft: ShareDraft;
  disabled: boolean;
  footer?: string;
  topLine?: ReactNode;
  onToggle: (item: ShareListItem) => void;
  onIcon: (item: ShareListItem) => void;
}) {
  return (
    <section className="w-full md:max-w-2xl" style={{ marginBottom: 22 }} data-testid={`share-list-${group.key}`}>
      {topLine}
      <h2 className={cx(GROUP_HEADER_CLASS, 'px-[4px] pb-[6px]')}>{group.label}</h2>
      <div className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
        {group.items.map((item) => {
          const ticked = isTicked(draft, item);
          const fixed = ticked && item.locked !== null;
          const joint = jointOn(draft, item);
          const Glyph = glyphOf(item);
          const icon = (
            <RowIcon mark={joint}>
              <Glyph size={15} aria-hidden />
            </RowIcon>
          );
          return (
            <div key={item.key} className="flex min-h-[50px] items-center gap-[10px] px-[13px] py-[6px]" data-testid="share-list-row">
              {item.canJoint ? (
                <button
                  type="button"
                  aria-pressed={joint}
                  aria-label={`Owned together, ${item.name}`}
                  disabled={disabled}
                  onClick={() => onIcon(item)}
                  className="ph-focus ph-tap shrink-0 rounded-full"
                  data-testid="share-list-icon"
                >
                  {icon}
                </button>
              ) : (
                icon
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] leading-[21px] text-[var(--ph-ink)]">
                  {item.name}
                  {joint ? <span className="sr-only">, {OWNED_TOGETHER}</span> : null}
                </span>
                {item.caption ? <span className="block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{item.caption}</span> : null}
              </span>
              {item.meta ? <span className="shrink-0 whitespace-nowrap text-[12.5px] text-[var(--ph-ink-3)]">{item.meta}</span> : null}
              <ListSwitch label={item.name} checked={ticked} disabled={disabled || fixed} onChange={() => !fixed && onToggle(item)} />
            </div>
          );
        })}
      </div>
      {footer ? <p className="px-[4px] pt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{footer}</p> : null}
    </section>
  );
}

/** The kit's switch, on a row that has more in it than a label: named by the item. */
function ListSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: () => void }) {
  return (
    <span className={cx('ph-focus-within relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors', checked ? 'bg-[var(--ph-switch-on)]' : 'bg-[var(--ph-track)]', disabled && 'opacity-40')}>
      <span
        aria-hidden
        className="absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-[var(--ph-knob)] shadow-[0_2px_5px_rgba(0,0,0,0.18)] transition-transform"
        style={{ transform: checked ? 'translateX(20px)' : undefined }}
      />
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-default"
      />
    </span>
  );
}

/**
 * Events in the list (redesign C, D): each with its switch and where it stands. On opens today's share sheet (its own
 * code, as before); off is today's Leave, asked first; a copy this phone can no longer change offers Delete this copy.
 * They act at once, as the Share page's events did: sharing an event moves its tagged spending, so it is never a draft.
 */
function EventsGroup({ group, onError }: { group: ShareListGroup; onError: (error: unknown) => void }) {
  const { database, sync, ws } = useApp();
  const invalidate = useInvalidateAll();
  const safetyCopy = useSafetyCopy('before-delete');
  const events = useEvents().data ?? [];
  const [sharing, setSharing] = useState<string | null>(null);
  const sharingEvent = events.find((event) => event.id === sharing) ?? null;

  async function leave(name: string, bookId: string) {
    if (!window.confirm(`Leave ${name}? What was recorded stays with the others.`)) return;
    onError(null);
    try {
      await sync.leaveEvent(bookId);
      await invalidate();
    } catch (failure) {
      onError(sayError(failure));
    }
  }

  async function deleteCopy(view: SharedEventView) {
    onError(null);
    try {
      const done = await deleteEventCopyFlow(view, {
        plan: () => planEventCopyDelete(database, ws, view.bookId),
        confirm: (text) => window.confirm(text),
        safetyCopy,
        remove: () => sync.deleteEventCopy(ws, view.bookId),
      });
      if (done === 'deleted') await invalidate();
    } catch (failure) {
      onError(sayError(failure));
    }
  }

  return (
    <section className="w-full md:max-w-2xl" style={{ marginBottom: 22 }} data-testid="share-list-events">
      <h2 className={cx(GROUP_HEADER_CLASS, 'px-[4px] pb-[6px]')}>{group.label}</h2>
      <div className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
        {group.items.map((item) => (
          <EventLine key={item.key} item={item} onShare={() => setSharing(item.id)} onLeave={(bookId) => void leave(item.name, bookId)} onDeleteCopy={(view) => void deleteCopy(view)} />
        ))}
      </div>
      {sharingEvent ? <ShareEventSheet event={sharingEvent} onClose={() => setSharing(null)} /> : null}
    </section>
  );
}

function EventLine({ item, onShare, onLeave, onDeleteCopy }: { item: ShareListItem; onShare: () => void; onLeave: (bookId: string) => void; onDeleteCopy: (view: SharedEventView) => void }) {
  const view = useSharedEventView(item.shared ? item.id : null).data;
  const leavable = view && !pageLocks(view).readOnly ? view : null;
  // A copy waiting for an invite is still its person's (review minor 2): only one left, removed or stopped is deleted.
  const readOnly = view && pageLocks(view).readOnly && view.state !== 'needs_invite' ? view : null;
  const others = (view?.people ?? []).filter((person) => !person.isMe && !person.removed);
  const inIt = others.filter((person) => person.hasApp).map((person) => person.name);
  const waitingFor = others.filter((person) => !person.hasApp).map((person) => person.name);
  const line = !item.shared ? item.meta : readOnly ? null : inIt.length > 0 ? `${namesOf(inIt)} ${inIt.length === 1 ? 'is' : 'are'} in` : view ? `Waiting for ${namesOf(waitingFor) || 'someone'} to join` : null;
  return (
    <div className="flex min-h-[50px] items-center gap-[10px] px-[13px] py-[6px]" data-testid="share-list-row">
      <RowIcon>
        <CalendarDays size={15} aria-hidden />
      </RowIcon>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] leading-[21px] text-[var(--ph-ink)]">{item.name}</span>
        {line ? (
          item.shared && inIt.length === 0 && view ? (
            <Link to="/events/$eventId" params={{ eventId: item.id }} data-testid="share-event-state" className="block truncate text-[12.5px] leading-[16px] text-[var(--ph-warn)]">
              {line} ›
            </Link>
          ) : (
            <span data-testid="share-event-state" className={cx('block truncate text-[12.5px] leading-[16px]', item.shared ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink-3)]')}>
              {line}
            </span>
          )
        ) : null}
      </span>
      {readOnly ? (
        <button type="button" data-testid="share-event-delete-copy" onClick={() => onDeleteCopy(readOnly)} className="ph-focus ph-tap shrink-0 text-[15px] text-[var(--ph-alarm)]">
          {DELETE_COPY_LABEL}
        </button>
      ) : (
        <ListSwitch label={item.name} checked={item.shared} disabled={item.shared && !leavable} onChange={() => (item.shared ? leavable && onLeave(leavable.bookId) : onShare())} />
      )}
    </div>
  );
}

/** What the workspace always shares, said once at the top: no switch, it is what sharing the workspace is. */
function AlwaysShared({ bookName }: { bookName: string }) {
  return (
    <InsetGroup wide header={SHARE_LIST_COPY.alwaysHeader(bookName)}>
      <InsetRow testId="share-list-always" icon={<Lock size={15} aria-hidden />} title={SHARE_LIST_COPY.alwaysTitle(bookName)} subtitle={SHARE_LIST_COPY.alwaysSubtitle} value="Always" chevron={false} />
    </InsetGroup>
  );
}
