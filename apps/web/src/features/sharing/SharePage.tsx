import { type BookRow, LeaveIncompleteError, SharingError, type SharingDetail } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeftRight, FileText, RefreshCw, TriangleAlert, User } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { eraseWidgetSummary } from '../../native/widget-summary';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, PushedTitle, SCREEN, SubmitRow, TextRow } from '../../ui/native';
import { InviteCard } from './InviteCard';
import { SHARE_LIST_COPY, sharedSummary } from './share-list';
import { joinedOthers, useShareList, useShareListAsked } from './ShareListPage';
import { useLostHere, useShareHealth, useSharingDetail } from './queries';
import { keepOpenInvite, useActionRunner, useOpenInvite, useShareBook } from './share-hooks';
import { rememberedName, rememberName, thisDeviceName } from './SharingSection';
import { useSyncState } from './sync-state';
import { currencyRefusal, DISCARD_LABEL, DISCARD_TITLE, discardConfirm, lastChangeLine, leaveConfirm, LOST_LINE, preparing, sayError, stopConfirm } from './sharing-copy';

/** What the person being invited will and will not see, and the one thing about devices worth knowing up front. */
const EXPLAINER = [
  'Whoever is invited sees this workspace just as it looks here — its purchases, categories, budgets and bills — and can add and change any of them. They never see accounts, cards or balances outside it, or any other workspace: a purchase paid from elsewhere shows only the name of what paid for it.',
  'Everything is encrypted on this device before it leaves; the relay that passes it along cannot read it.',
  'An invite is for one device. A replaced or restored phone needs a new invite.',
];

/** Step 1's lede (2026-11-13): what sharing the workspace shares at once, and what waits for step 3. */
export const SETUP_LEDE = (bookName: string) =>
  `Budgets, bills and transactions in ${bookName} will be shared. Accounts, goals and events stay private until switched on in step 3.`;

/** The route's page: Workspace › Share. */
export function SharePage() {
  const { bookId } = useParams({ from: '/account/workspaces/$bookId/share' });
  const book = useShareBook(bookId);
  return (
    <div className={SCREEN}>
      <PushedTitle title="Share" back="Workspace" backTo="/account/workspaces/$bookId" backParams={{ bookId }} />
      <div className="pt-[2px]">{book ? <ShareBody book={book} /> : book === null ? <InsetGroup wide><InsetRow title="That workspace is not here." chevron={false} /></InsetGroup> : null}</div>
    </div>
  );
}

function ShareBody({ book }: { book: BookRow }) {
  const detail = useSharingDetail(book.id);
  const lost = useLostHere(book.id);
  const [discarding, setDiscarding] = useState(false);
  if (detail.isPending) return null;
  // Shared: Members, Shared with, Sync, and the way out (redesign A1). Every warning is under Sync details.
  if (detail.data) return <Shared book={book} detail={detail.data} sheetOpen={false} />;
  return (
    <>
      {/* A share this phone held and lost (sharing resilience §6.2, §7): said first, with the one way on in this update. */}
      {lost ? (
        <InsetGroup wide footer={<span data-testid="share-lost-line">{LOST_LINE(book.name)}</span>}>
          <InsetRow testId="share-discard-row" icon={<TriangleAlert size={15} aria-hidden />} title={DISCARD_LABEL} onClick={() => setDiscarding(true)} chevron={false} />
        </InsetGroup>
      ) : null}
      <ShareForm book={book} refetch={async () => void (await detail.refetch())} onLostShare={() => setDiscarding(true)} />
      {discarding ? <DiscardSheet book={book} onClose={() => setDiscarding(false)} /> : null}
      {/* Not shared: a book whose sharing went missing here still has its history in the log, kept by its local id. */}
      <InsetGroup wide>
        <InsetRow testId="sync-details-row" icon={<FileText size={15} aria-hidden />} title="Sync details" to="/account/workspaces/$bookId/share/details" params={{ bookId: book.id }} />
      </InsetGroup>
    </>
  );
}

/** Discard old share (§7, review N2): asked, then this phone's record of the lost share goes and Share works again. */
export function DiscardSheet({ book, onClose }: { book: BookRow; onClose: () => void }) {
  const joined = book.kind === 'shared';
  const { sync } = useApp();
  const { busy, error, run } = useActionRunner();
  return (
    <Sheet
      title={DISCARD_TITLE}
      onClose={onClose}
      confirm={{
        label: DISCARD_LABEL,
        disabled: busy,
        run: () =>
          void run(async () => {
            await sync.discardShareRecord(book.id);
            onClose();
          }),
      }}
    >
      <ErrorBox error={error} />
      <p className="text-[15px] leading-[20px]">{discardConfirm(book.name, joined)}</p>
    </Sheet>
  );
}

/** Not shared yet: a Name and a Share button; the button becomes the progress while the history goes up. */
function ShareForm({ book, refetch, onLostShare }: { book: BookRow; refetch: () => Promise<void>; onLostShare: () => void }) {
  const { ws, sync } = useApp();
  const [name, setName] = useState(rememberedName);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);

  // §6.5 step 0 (ruled O3): a workspace in another currency than the app's own is refused before anything is made.
  const refusal = book.baseCurrency !== ws.baseCurrency ? currencyRefusal(book.baseCurrency, ws.baseCurrency) : null;
  if (refusal) {
    return (
      <p data-testid="share-refusal" className="px-[13px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
        {refusal}
      </p>
    );
  }

  async function share(event: FormEvent) {
    event.preventDefault();
    const memberName = name.trim();
    if (!memberName || progress) return;
    setError(null);
    rememberName(memberName);
    setProgress({ done: 0, total: 0 });
    try {
      const made = await sync.share(book.id, { memberName, deviceName: thisDeviceName() }, (done, total) => setProgress({ done, total }));
      keepOpenInvite(book.id, made);
      await refetch();
    } catch (failure) {
      // A share this phone lost is in the way (review N2): nothing was made; the discard is asked for.
      if (failure instanceof SharingError && failure.code === 'RECORD_ELSEWHERE') {
        onLostShare();
        return;
      }
      setError(sayError(failure));
      // Once the history was written the workspace is shared even though it has not gone up yet: the shared view
      // says so ("N changes waiting", "Not synced"), keeps trying, and Invite someone asks again (fix round 1).
      await refetch();
    } finally {
      setProgress(null);
    }
  }

  return (
    <form onSubmit={(event) => void share(event)} aria-label="Share this workspace">
      <ErrorBox error={error} />
      {progress ? (
        <InsetGroup wide footer="History goes up first, so whoever joins sees all of it. Keep this open until it is done.">
          <InsetRow testId="share-progress" icon={<RefreshCw size={15} aria-hidden />} title={progress.total > 0 ? preparing(progress.done, progress.total) : 'Preparing…'} chevron={false} />
        </InsetGroup>
      ) : (
        <>
          <p data-testid="share-step" className="mb-[6px] text-center text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Step 1 of 3</p>
          <p data-testid="share-lede" className="mb-[12px] px-[4px] text-[13px] leading-[18px] text-[var(--ph-ink-2)]">{SETUP_LEDE(book.name)}</p>
          <InsetGroup wide>
            <TextRow
              label="Name shown"
              data-testid="share-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="As the others will see it"
              required
              autoComplete="name"
              info={EXPLAINER.map((line) => (
                <span key={line} className="mb-[6px] block">
                  {line}
                </span>
              ))}
            />
          </InsetGroup>
          <InsetGroup wide>
            <SubmitRow testId="share-button" label="Create invite" disabled={!name.trim()} />
          </InsetGroup>
        </>
      )}
    </form>
  );
}

type Confirming = { kind: 'leave' } | { kind: 'stop' } | null;

/**
 * Shared (redesign A1, 2026-11-13): Members — this phone's own row, the others with their last change, Invite someone —
 * then "Shared with Andi", then one Sync row ("Up to date", or a red count of what needs fixing, listed on Sync
 * details), and the way out last and alone. While nobody has joined, the invite made at Share is step 2 of 3.
 */
function Shared({ book, detail, sheetOpen }: { book: BookRow; detail: SharingDetail; sheetOpen: boolean }) {
  const { sync } = useApp();
  const navigate = useNavigate();
  const health = useShareHealth(book.id).data;
  const state = useSyncState(book, detail);
  const invite = useOpenInvite(book.id);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [retryLeave, setRetryLeave] = useState(false);
  const [inviting, setInviting] = useState(false);
  const { busy, error, run } = useActionRunner();
  const me = detail.members.find((member) => member.me) ?? null;
  const now = Date.now();
  const { active, frozen } = state;
  // Joined means a device of theirs is in the book: a member remembered from an earlier share has none yet.
  const someoneJoined = detail.members.some((member) => !member.me && member.devices.length > 0);
  const inviteLive = invite !== null && active && !frozen && new Date(invite.expiresAt).getTime() > now;
  const showInvite = inviteLive && (!someoneJoined || inviting);
  const silenceOf = new Map((health?.silence ?? []).map((s) => [s.memberId, s]));
  // The one list of what is shared (2026-11-12): offered once on the phone that shared the workspace, as the last step
  // of setting it up, when someone it was not yet offered for has joined; on the Share page as a row after that.
  const joined = joinedOthers(detail);
  const asked = useShareListAsked(book.id);
  const shareList = useShareList(book.id).list;
  const stepDue = active && !frozen && !sheetOpen && confirming === null && book.kind !== 'shared' && asked.isSuccess && !asked.isFetching && joined.some((member) => !asked.data.includes(member.memberId));
  useEffect(() => {
    if (stepDue) void navigate({ to: '/account/workspaces/$bookId/share/what/start', params: { bookId: book.id }, replace: true });
  }, [stepDue, navigate, book.id]);
  // Another owner in the share: an owner may leave too (the last one is told to make someone else owner first).
  const otherOwner = detail.members.some((member) => !member.me && member.role === 'owner');

  async function leave() {
    setConfirming(null);
    let incomplete = false;
    await run(async () => {
      try {
        await sync.leave(book.id);
        // The widget must not keep showing a workspace left (spec §E): erased now, written afresh for the next one.
        await eraseWidgetSummary();
      } catch (failure) {
        incomplete = failure instanceof LeaveIncompleteError;
        throw failure;
      }
    });
    setRetryLeave(incomplete);
  }

  async function inviteSomeone() {
    await run(async () => {
      keepOpenInvite(book.id, await sync.invite(book.id, me?.name ?? ''));
      setInviting(true);
    });
  }

  const count = state.problems.length;
  return (
    <div data-testid="sharing-section">
      <ErrorBox error={error} />

      {showInvite && invite ? (
        <>
          {!someoneJoined ? <p data-testid="share-step" className="mb-[6px] text-center text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Step 2 of 3</p> : null}
          <InviteCard invite={invite} bookName={book.name} inviterName={me?.name ?? ''} header="Invite" />
        </>
      ) : null}

      {active ? (
        <InsetGroup wide header="Members">
          {detail.members.map((member) => (
            <InsetRow
              key={member.memberId}
              testId="sharing-member"
              icon={<User size={15} aria-hidden />}
              title={member.name}
              subtitle={member.me ? 'This phone' : lastChangeLine(silenceOf.get(member.memberId) ?? { lastChangeAt: null }, now)}
              value={member.role === 'owner' ? 'Owner' : 'Member'}
              to="/account/workspaces/$bookId/share/members/$memberId"
              params={{ bookId: book.id, memberId: member.memberId }}
            />
          ))}
          {!someoneJoined ? <InsetRow testId="sharing-waiting" icon={<User size={15} aria-hidden />} title="Waiting for someone" value={showInvite ? 'Invite open' : undefined} chevron={false} /> : null}
          {detail.owner && !frozen && someoneJoined ? <InsetRow testId="sharing-invite" title={<span className="text-[var(--ph-tint)]">Invite someone</span>} label="Invite someone" chevron={false} disabled={busy} onClick={() => void inviteSomeone()} /> : null}
        </InsetGroup>
      ) : null}

      {active && !frozen && someoneJoined ? (
        <InsetGroup wide>
          <InsetRow
            testId="share-list-row"
            icon={<ArrowLeftRight size={15} aria-hidden />}
            title={SHARE_LIST_COPY.title(joined.map((member) => member.name), book.name)}
            subtitle={shareList ? sharedSummary(shareList) : undefined}
            to="/account/workspaces/$bookId/share/what"
            params={{ bookId: book.id }}
          />
        </InsetGroup>
      ) : null}

      <InsetGroup wide>
        <InsetRow
          testId="sharing-sync-row"
          icon={<RefreshCw size={15} aria-hidden />}
          title="Sync"
          label={count > 0 ? `Sync, ${count} to fix` : `Sync, ${state.value}`}
          value={count > 0 ? <CountBadge count={count} /> : state.value}
          to="/account/workspaces/$bookId/share/details"
          params={{ bookId: book.id }}
        />
      </InsetGroup>

      {/* The way out, last and alone: Stop sharing for an owner (§8.6), Leave for a member — and for an owner beside another one (§8.4). */}
      {active ? (
        <InsetGroup wide footer={retryLeave ? 'Leaving did not finish. Try again.' : undefined}>
          {!detail.owner || otherOwner || retryLeave ? (
            <DestructiveRow calm={detail.owner} label={retryLeave ? 'Try leaving again' : `Leave ${book.name}`} onClick={() => (retryLeave ? void leave() : setConfirming({ kind: 'leave' }))} />
          ) : null}
          {detail.owner ? <DestructiveRow label={`Stop sharing ${book.name}`} onClick={() => setConfirming({ kind: 'stop' })} /> : null}
        </InsetGroup>
      ) : null}

      {confirming?.kind === 'leave' ? (
        <Sheet title="Leave this workspace?" onClose={() => setConfirming(null)} confirm={{ label: 'Leave', disabled: busy, run: () => void leave() }}>
          <p className="text-[15px] leading-[20px]">{leaveConfirm(book.name)}</p>
        </Sheet>
      ) : null}
      {confirming?.kind === 'stop' ? (
        <Sheet
          title="Stop sharing?"
          onClose={() => setConfirming(null)}
          confirm={{
            label: 'Stop sharing',
            disabled: busy,
            run: () => {
              setConfirming(null);
              void run(async () => {
                await sync.stopSharing(book.id);
                // An ordinary workspace again, which could be shared anew: back to its page, where the Share row says Off.
                await navigate({ to: '/account/workspaces/$bookId', params: { bookId: book.id } });
              });
            },
          }}
        >
          <p className="text-[15px] leading-[20px]">{stopConfirm(book.name)}</p>
        </Sheet>
      ) : null}
    </div>
  );
}

/** The red count iOS Settings draws beside a row that needs something: how many things are listed under To fix. */
export function CountBadge({ count }: { count: number }) {
  return (
    <span data-testid="sync-count" className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[var(--ph-alarm)] px-[6px] text-[12px] leading-none font-semibold text-white">
      {count}
    </span>
  );
}
