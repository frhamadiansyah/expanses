import { type BookRow, LeaveIncompleteError, type SharingDetail } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { CalendarDays, FileText, Landmark, RefreshCw, User } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { eraseWidgetSummary } from '../../native/widget-summary';
import { ErrorBox } from '../../ui';
import { DestructiveRow, type GroupChild, InsetGroup, InsetRow, PushedTitle, SCREEN, SubmitRow, TextRow } from '../../ui/native';
import { useEvents } from '../events/queries';
import { ShareEventSheet } from '../events/ShareEventSheet';
import { useSharedEventSummaries, useSharedEventView } from '../events/shared-queries';
import { pageLocks } from '../events/shared-view';
import { InviteCard } from './InviteCard';
import { type ShareEventRow, shareEventRows } from './share-events';
import { useNetWorthGroup } from './net-worth-queries';
import { netWorthRowOf, netWorthValue } from './net-worth-state';
import { useBookStatus, useSharingDetail, useSyncStatus } from './queries';
import { keepOpenInvite, useActionRunner, useOpenInvite, useShareBook } from './share-hooks';
import { rememberedName, rememberName, thisDeviceName } from './SharingSection';
import { currencyRefusal, FORGET_ROW, forgetConfirm, FROZEN_NOTE, lastFailedLine, lastSyncedLine, leaveConfirm, preparing, READ_ONLY_NOTE, sayError, shareStatusLine, stopConfirm } from './sharing-copy';

/** What the person being invited will and will not see, and the one thing about devices worth knowing up front. */
const EXPLAINER = [
  'Whoever is invited sees this workspace just as it looks here — its purchases, categories, budgets and bills — and can add and change any of them. They never see accounts, cards or balances outside it, or any other workspace: a purchase paid from elsewhere shows only the name of what paid for it.',
  'Everything is encrypted on this device before it leaves; the relay that passes it along cannot read it.',
  'An invite is for one device. A replaced or restored phone needs a new invite.',
];

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
  if (detail.isPending) return null;
  return (
    <>
      {detail.data ? <Shared book={book} detail={detail.data} /> : <ShareForm book={book} refetch={async () => void (await detail.refetch())} />}
      {/* Shared or not: a book whose sharing went missing here still has its history in the log, kept by its local id. */}
      <InsetGroup wide>
        <InsetRow testId="sync-details-row" icon={<FileText size={15} aria-hidden />} title="Details" to="/account/workspaces/$bookId/share/details" params={{ bookId: book.id }} />
      </InsetGroup>
      <ShareEvents />
    </>
  );
}

/** The owner's events, each shared from here or left from here: Share opens the event's own sheet, Leave is the event page's (D9). */
function ShareEvents() {
  const { sync } = useApp();
  const invalidate = useInvalidateAll();
  const events = useEvents();
  const summaries = useSharedEventSummaries();
  const [sharing, setSharing] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!events.data || summaries.isPending) return null;
  const rows = shareEventRows(events.data, summaries.data ?? {});
  if (rows.length === 0) return null;
  const sharingEvent = events.data.find((event) => event.id === sharing) ?? null;

  async function leave(row: ShareEventRow, bookId: string) {
    if (!window.confirm(`Leave ${row.name}? What was recorded stays with the others.`)) return;
    setError(null);
    try {
      await sync.leaveEvent(bookId);
      await invalidate();
    } catch (failure) {
      setError(sayError(failure));
    }
  }

  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup wide header="Events">
        {rows.map((row) => (
          <ShareEventLine key={row.eventId} row={row} onShare={() => setSharing(row.eventId)} onLeave={(bookId) => void leave(row, bookId)} />
        ))}
      </InsetGroup>
      {sharingEvent ? <ShareEventSheet event={sharingEvent} onClose={() => setSharing(null)} /> : null}
    </>
  );
}

/** One event. A shared one is read for its book and for whether this phone's person is still in it; one already left has nothing to leave. */
function ShareEventLine({ row, onShare, onLeave, position }: GroupChild & { row: ShareEventRow; onShare: () => void; onLeave: (bookId: string) => void }) {
  const view = useSharedEventView(row.shared ? row.eventId : null).data;
  const leavable = view && !pageLocks(view).readOnly ? view : null;
  return (
    <InsetRow
      position={position}
      testId="share-event-row"
      icon={<CalendarDays size={15} aria-hidden />}
      title={row.name}
      value={row.value}
      label={row.shared ? `Leave ${row.name}` : `Share ${row.name}`}
      onClick={row.shared ? (leavable ? () => onLeave(leavable.bookId) : undefined) : onShare}
    />
  );
}

/** Not shared yet: a Name and a Share button; the button becomes the progress while the history goes up. */
function ShareForm({ book, refetch }: { book: BookRow; refetch: () => Promise<void> }) {
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
          <InsetGroup wide>
            <TextRow
              label="Name"
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
            <SubmitRow testId="share-button" label="Share" disabled={!name.trim()} />
          </InsetGroup>
        </>
      )}
    </form>
  );
}

type Confirming = { kind: 'leave' } | { kind: 'stop' } | { kind: 'forget' } | null;

/** Shared: the status line, the invite while nobody has joined, the members, Net worth, and the ways out. */
function Shared({ book, detail }: { book: BookRow; detail: SharingDetail }) {
  const { sync } = useApp();
  const navigate = useNavigate();
  const live = useSyncStatus(book.id);
  const engineStatus = useBookStatus(book.id);
  const group = useNetWorthGroup(book.id);
  const invite = useOpenInvite(book.id);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [retryLeave, setRetryLeave] = useState(false);
  const { busy, error, run } = useActionRunner();
  const me = detail.members.find((member) => member.me) ?? null;
  const now = Date.now();
  const status = engineStatus.data?.status ?? null;
  const frozen = engineStatus.data?.frozen ?? false;
  const active = detail.state === 'active';
  // A share that is dead here — ended, waiting for an invite nobody may be able to give, or frozen — can be kept as
  // this device's own copy (final review, C1). While an owner device is in, the way out is Leave.
  const forgettable = !active || frozen;
  // Joined means a device of theirs is in the book: a member remembered from an earlier share has none yet.
  const someoneJoined = detail.members.some((member) => !member.me && member.devices.length > 0);
  const showInvite = invite !== null && active && !frozen && !someoneJoined && new Date(invite.expiresAt).getTime() > now;

  const line = shareStatusLine({ status, pending: engineStatus.isPending, error: engineStatus.error, failing: live.failing, now });
  const storedSync = status && 'syncedAt' in status && status.syncedAt ? Date.parse(status.syncedAt) : status?.state === 'stale' ? Date.parse(status.since) : null;
  const lastSynced = live.lastSyncedAt ?? (storedSync !== null && Number.isFinite(storedSync) ? storedSync : null);
  const note = status?.state === 'frozen' ? FROZEN_NOTE : status?.state === 'unshared' ? READ_ONLY_NOTE : active ? lastSyncedLine(lastSynced, now) : undefined;
  const failedLine = live.failing && live.lastError ? lastFailedLine(live.lastError) : undefined;
  const netWorth = netWorthRowOf(group.data, detail.members);

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

  return (
    <div data-testid="sharing-section">
      <ErrorBox error={error} />
      <InsetGroup wide footer={failedLine ? <span data-testid="sharing-last-failure">{failedLine}</span> : undefined}>
        <InsetRow
          testId="sharing-status"
          icon={<RefreshCw size={15} aria-hidden />}
          title={line}
          subtitle={note}
          value={active ? (live.running ? 'Syncing…' : 'Sync now') : undefined}
          chevron={false}
          onClick={active ? () => void sync.syncNow(book.id) : undefined}
        />
      </InsetGroup>

      {showInvite && invite ? <InviteCard invite={invite} bookName={book.name} inviterName={me?.name ?? ''} header="Invite" /> : null}

      {active ? (
        <InsetGroup wide header="Members">
          {detail.members.map((member) => (
            <InsetRow
              key={member.memberId}
              testId="sharing-member"
              icon={<User size={15} aria-hidden />}
              title={member.me ? `${member.name} (me)` : member.name}
              value={member.role === 'owner' ? 'Owner' : 'Member'}
              to="/account/workspaces/$bookId/share/members/$memberId"
              params={{ bookId: book.id, memberId: member.memberId }}
            />
          ))}
          {!someoneJoined ? <InsetRow testId="sharing-waiting" icon={<User size={15} aria-hidden />} title="Waiting for someone" value={showInvite ? 'Invite open' : undefined} chevron={false} /> : null}
        </InsetGroup>
      ) : null}

      {/* Joint net worth (spec §6, §8.1): a workspace shared with someone else can share net worth too. */}
      {active && !frozen && netWorth.show && !group.isPending ? (
        <InsetGroup wide>
          <InsetRow
            testId="net-worth-row"
            icon={<Landmark size={15} aria-hidden />}
            title="Net worth"
            value={netWorthValue(netWorth)}
            to="/account/workspaces/$bookId/share/net-worth"
            params={{ bookId: book.id }}
          />
        </InsetGroup>
      ) : null}

      {/* Leave (§8.4): anyone, on themselves; the last owner is told to make someone else owner first. Stop sharing (§8.6): owners only. */}
      {active ? (
        <InsetGroup wide footer={retryLeave ? 'Leaving did not finish. Try again.' : undefined}>
          <DestructiveRow calm label={retryLeave ? 'Try leaving again' : 'Leave'} onClick={() => (retryLeave ? void leave() : setConfirming({ kind: 'leave' }))} />
          {detail.owner ? <DestructiveRow label="Stop sharing" onClick={() => setConfirming({ kind: 'stop' })} /> : null}
        </InsetGroup>
      ) : null}

      {/* Keep as my own copy (C1): the way out of a share that is dead here. Local only, confirmed. */}
      {forgettable ? (
        <InsetGroup wide>
          <DestructiveRow label={FORGET_ROW} onClick={() => setConfirming({ kind: 'forget' })} />
        </InsetGroup>
      ) : null}

      {confirming?.kind === 'leave' ? (
        <Sheet title="Leave this workspace?" onClose={() => setConfirming(null)} confirm={{ label: 'Leave', disabled: busy, run: () => void leave() }}>
          <p className="text-[15px] leading-[20px]">{leaveConfirm(book.name)}</p>
        </Sheet>
      ) : null}
      {confirming?.kind === 'forget' ? (
        <Sheet
          title="Keep as its own copy?"
          onClose={() => setConfirming(null)}
          confirm={{
            label: 'Keep as my own copy',
            disabled: busy,
            run: () => {
              setConfirming(null);
              void run(() => sync.forgetSharing(book.id));
            },
          }}
        >
          <p className="text-[15px] leading-[20px]">{forgetConfirm(book.name)}</p>
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
