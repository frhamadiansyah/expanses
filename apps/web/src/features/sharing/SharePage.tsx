import { type BookRow, LeaveIncompleteError, type SharingDetail } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Landmark, RefreshCw, User } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, PushedTitle, SCREEN, SubmitRow, TextRow } from '../../ui/native';
import { InviteCard } from './InviteCard';
import { useNetWorthGroup } from './net-worth-queries';
import { netWorthRowOf, netWorthValue } from './net-worth-state';
import { useBookStatus, useSharingDetail, useSyncStatus } from './queries';
import { keepOpenInvite, useActionRunner, useOpenInvite, useShareBook } from './share-hooks';
import { rememberedName, rememberName, thisDeviceName } from './SharingSection';
import { currencyRefusal, FORGET_ROW, forgetConfirm, FROZEN_NOTE, leaveConfirm, preparing, READ_ONLY_NOTE, sayError, statusLineOf, stopConfirm } from './sharing-copy';

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
  if (!detail.data) return <ShareForm book={book} refetch={async () => void (await detail.refetch())} />;
  return <Shared book={book} detail={detail.data} />;
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

  const line = status ? statusLineOf(status, { failing: live.failing, now }) : 'Checking…';
  const note = status?.state === 'frozen' ? FROZEN_NOTE : status?.state === 'unshared' ? READ_ONLY_NOTE : undefined;
  const netWorth = netWorthRowOf(group.data, detail.members);

  async function leave() {
    setConfirming(null);
    let incomplete = false;
    await run(async () => {
      try {
        await sync.leave(book.id);
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
      <InsetGroup wide>
        <InsetRow
          testId="sharing-status"
          icon={<RefreshCw size={15} aria-hidden />}
          title={line}
          subtitle={note}
          value={active ? 'Sync now' : undefined}
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
