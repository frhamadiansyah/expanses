import { type BookRow, type CreatedInvite, LeaveIncompleteError, type SharedDevice, type SharedMemberDetail, type SharingDetail } from '@expanses/db';
import { Crown, Landmark, Laptop, Link2, RefreshCw, Smartphone, User, UserPlus, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, SubmitRow, TextRow } from '../../ui/native';
import { InviteCard } from './InviteCard';
import { useNetWorthGroup, useReview } from './net-worth-queries';
import { JOINT_LINE, needsReview, netWorthRowOf, sayNetWorthError } from './net-worth-state';
import { NetWorthReview } from './NetWorthReview';
import { NetWorthSetup } from './NetWorthSetup';
import { useBookStatus, useSharingDetail, useSyncStatus } from './queries';
import { currencyRefusal, deviceName, FORGET_ROW, forgetConfirm, FROZEN_NOTE, leaveConfirm, preparing, READ_ONLY_NOTE, sayError, statusLineOf, stopConfirm, syncedAgo } from './sharing-copy';

/*
 * Settings → Workspaces → a workspace, the sharing rows (household sharing spec §11): Share this workspace, then the
 * status line, the members with their devices and Remove, Link a device, Make owner, Leave, Stop sharing, and — once
 * a share is dead here — Stop sharing on this device (C1). Every row is the native kit's own; the same section draws
 * in the phone's sheet and the desktop's panel.
 */

const NAME_KEY = 'cicis.sharing.name';

function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // A private window: the name is simply asked for again next time.
  }
}

export const thisDeviceName = () => deviceName(navigator.userAgent, navigator.platform);

type Flow = { step: 'explain' } | { step: 'preparing'; done: number; total: number };

/** What the person being invited will and will not see, and the one thing about devices worth knowing up front. */
const EXPLAINER = [
  'Whoever you invite sees this workspace as you do — its purchases, categories, budgets and bills — and can add and change any of them. They never see your accounts, cards or balances, or your other workspaces: a purchase you paid for shows them only the name of what you paid with.',
  'Everything is encrypted on this device before it leaves; the relay that passes it along cannot read it.',
  'An invite is for one device. A replaced or restored phone needs a new invite.',
];

export function SharingSection({ book }: { book: BookRow }) {
  const { ws, sync } = useApp();
  const detail = useSharingDetail(book.id);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [invite, setInvite] = useState<{ invite: CreatedInvite; kind: 'someone' | 'device'; forName?: string } | null>(null);
  const [name, setName] = useState(rememberedName);
  const [error, setError] = useState<unknown>(null);

  // §6.5 step 0 (ruled O3): a workspace in another currency than yours is refused before anything is made.
  const refusal = book.baseCurrency !== ws.baseCurrency ? currencyRefusal(book.baseCurrency, ws.baseCurrency) : null;

  async function share(event: FormEvent) {
    event.preventDefault();
    const memberName = name.trim();
    if (!memberName) return;
    setError(null);
    rememberName(memberName);
    setFlow({ step: 'preparing', done: 0, total: 0 });
    try {
      const made = await sync.share(book.id, { memberName, deviceName: thisDeviceName() }, (done, total) => setFlow({ step: 'preparing', done, total }));
      setInvite({ invite: made, kind: 'someone' });
      setFlow(null);
      await detail.refetch();
    } catch (failure) {
      setError(sayError(failure));
      // Once the history was written the workspace is shared even though it has not gone up yet: the shared view
      // says so ("N changes waiting", "Not synced"), keeps trying, and Invite someone asks again (fix round 1).
      const now = await detail.refetch();
      setFlow(now.data ? null : { step: 'explain' });
    }
  }

  if (flow?.step === 'preparing') {
    return (
      <InsetGroup wide header="Sharing" footer="Your history goes up first, so whoever joins sees all of it. Keep this open until it is done.">
        <InsetRow testId="share-progress" icon={<RefreshCw size={15} aria-hidden />} title={flow.total > 0 ? preparing(flow.done, flow.total) : 'Preparing…'} chevron={false} />
      </InsetGroup>
    );
  }

  if (flow?.step === 'explain') {
    return (
      <form onSubmit={(event) => void share(event)} aria-label="Share this workspace">
        <ErrorBox error={error} />
        <InsetGroup wide header="Share this workspace" footer={EXPLAINER.map((line) => <span key={line} className="mb-[6px] block">{line}</span>)}>
          <TextRow label="Your name" value={name} onChange={(event) => setName(event.target.value)} placeholder="As the others will see it" required autoComplete="name" />
          <SubmitRow label="Share" disabled={!name.trim()} />
        </InsetGroup>
        <InsetGroup wide>
          <InsetRow title="Not now" chevron={false} onClick={() => setFlow(null)} />
        </InsetGroup>
      </form>
    );
  }

  if (detail.isPending) return null;
  const shareError = error ? <ErrorBox error={error} /> : null;
  if (!detail.data) {
    return (
      <InsetGroup wide header="Sharing" footer={refusal ?? 'Record into this workspace together with someone else, each from your own phone.'}>
        <InsetRow
          icon={<Users size={15} aria-hidden />}
          title="Share this workspace"
          disabled={refusal !== null}
          onClick={() => {
            setError(null);
            setFlow({ step: 'explain' });
          }}
        />
      </InsetGroup>
    );
  }

  return (
    <>
    {shareError}
    <Shared
      book={book}
      detail={detail.data}
      invite={invite}
      onInvite={setInvite}
    />
    </>
  );
}

type Confirming = { kind: 'leave' } | { kind: 'stop' } | { kind: 'forget' } | null;

function Shared({
  book,
  detail,
  invite,
  onInvite,
}: {
  book: BookRow;
  detail: SharingDetail;
  invite: { invite: CreatedInvite; kind: 'someone' | 'device'; forName?: string } | null;
  onInvite: (invite: { invite: CreatedInvite; kind: 'someone' | 'device'; forName?: string } | null) => void;
}) {
  const { sync } = useApp();
  const live = useSyncStatus(book.id);
  const engineStatus = useBookStatus(book.id);
  const [armed, setArmed] = useState<{ device: SharedDevice; member: SharedMemberDetail } | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [retryLeave, setRetryLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const me = detail.members.find((member) => member.me) ?? null;
  const now = Date.now();
  const status = engineStatus.data?.status ?? null;
  const frozen = engineStatus.data?.frozen ?? false;
  const active = detail.state === 'active';
  // What an owner may do to others, and only while an owner device is left (§8.5): a frozen book offers none of it.
  const steering = active && detail.owner && !frozen;
  // A share that is dead here — ended, waiting for an invite nobody may be able to give, or frozen — can be kept as
  // this device's own copy (final review, C1). While an owner device is in, the way out is Leave.
  const forgettable = !active || frozen;

  const line = status ? statusLineOf(status, { failing: live.failing, now }) : 'Checking…';
  const note = status?.state === 'frozen' ? FROZEN_NOTE : status?.state === 'unshared' ? READ_ONLY_NOTE : active ? 'Tap to sync now' : undefined;

  async function run(work: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (failure) {
      setError(sayError(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

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

  const rows = detail.members.flatMap((member) => [
    <InsetRow
      key={`m:${member.memberId}`}
      testId="sharing-member"
      icon={<User size={15} aria-hidden />}
      title={member.me ? `${member.name} (you)` : member.name}
      value={member.role === 'owner' ? 'Owner' : 'Member'}
      chevron={false}
    />,
    ...member.devices.map((device) => {
      const removable = steering && !device.mine;
      return (
        <InsetRow
          key={`d:${device.deviceId}`}
          testId="sharing-device"
          label={`${device.name}, ${member.name}`}
          icon={/phone|iPhone|Android/i.test(device.name) ? <Smartphone size={15} aria-hidden /> : <Laptop size={15} aria-hidden />}
          title={device.name}
          subtitle={device.mine ? `This device · ${syncedAgo(device.seenAt ?? live.lastSyncedAt, now)}` : syncedAgo(device.seenAt, now)}
          chevron={removable}
          className="pl-[28px]"
          onClick={removable ? () => setArmed((was) => (was?.device.deviceId === device.deviceId ? null : { device, member })) : undefined}
        />
      );
    }),
    // Make owner (§8.5): an owner, on another member who is not one yet.
    ...(steering && !member.me && member.role !== 'owner'
      ? [
          <InsetRow
            key={`o:${member.memberId}`}
            className="pl-[28px]"
            icon={<Crown size={15} aria-hidden />}
            label={`Make ${member.name} an owner`}
            title="Make owner"
            chevron={false}
            onClick={() => void run(() => sync.makeOwner(book.id, member.memberId))}
          />,
        ]
      : []),
    // Link a device (§8.3): an owner's invite, for their own member or, for a replaced phone, another's (fix round 1).
    ...(active && (member.me || steering)
      ? [
          steering ? (
            <InsetRow
              key={`l:${member.memberId}`}
              className="pl-[28px]"
              icon={<Link2 size={15} aria-hidden />}
              label={member.me ? 'Link a device' : `Link a device for ${member.name}`}
              title={member.me ? 'Link a device' : `Link a device for ${member.name}`}
              chevron={false}
              onClick={() =>
                void run(async () =>
                  onInvite({
                    invite: member.me ? await sync.linkDevice(book.id, member.name) : await sync.linkDeviceFor(book.id, me?.name ?? '', member.memberId),
                    kind: 'device',
                    forName: member.me ? undefined : member.name,
                  }),
                )
              }
            />
          ) : (
            <InsetRow
              key="link"
              testId="ask-owner-to-link"
              className="pl-[28px]"
              icon={<Link2 size={15} aria-hidden />}
              title="Ask an owner to link a new device"
              subtitle={frozen ? 'No owner has a device here any more' : 'Only an owner can invite a device into this workspace'}
              chevron={false}
            />
          ),
        ]
      : []),
  ]);

  return (
    <div data-testid="sharing-section">
      <ErrorBox error={error} />
      <InsetGroup wide header="Sharing">
        <InsetRow
          testId="sharing-status"
          icon={<RefreshCw size={15} aria-hidden />}
          title={line}
          subtitle={note}
          chevron={false}
          onClick={active ? () => void sync.syncNow(book.id) : undefined}
        />
        {steering ? (
          <InsetRow
            icon={<UserPlus size={15} aria-hidden />}
            title="Invite someone"
            chevron={false}
            onClick={() => void run(async () => onInvite({ invite: await sync.invite(book.id, me?.name ?? ''), kind: 'someone' }))}
          />
        ) : null}
      </InsetGroup>

      {invite && active && !frozen ? (
        <InviteCard
          invite={invite.invite}
          bookName={book.name}
          inviterName={me?.name ?? ''}
          header={invite.kind === 'device' ? (invite.forName ? `Link a device for ${invite.forName}` : 'Link a device') : 'Invite'}
          footer={
            invite.kind === 'device'
              ? invite.forName
                ? `On ${invite.forName}’s new device, choose Join a workspace and enter this code. It joins as ${invite.forName}.`
                : 'On your other device, choose Join a workspace and enter this code. It joins as you.'
              : 'Send this to the person you are sharing with. On their phone they choose Join a workspace and enter the code, or open the link.'
          }
        />
      ) : null}

      {active ? (
        <InsetGroup wide header="Members">
          {rows}
        </InsetGroup>
      ) : null}

      {/* Joint net worth (spec §6, §8.1): a workspace shared with someone else can share net worth too. */}
      {active && !frozen ? <NetWorthSection bookId={book.id} detail={detail} groupFailing={live.groupFailing} /> : null}

      {armed && steering ? (
        <InsetGroup wide footer={`${armed.device.name} stops receiving ${book.name}, and cannot read anything written after. What it already holds stays on it.`}>
          <DestructiveRow
            label={busy ? 'Removing…' : `Remove ${armed.member.name}’s ${armed.device.name}`}
            onClick={() =>
              void run(async () => {
                await sync.removeDevice(book.id, armed.device.deviceId);
                setArmed(null);
              })
            }
          />
        </InsetGroup>
      ) : null}

      {/* Leave (§8.4): anyone, on themselves; the last owner is told to make someone else owner first. */}
      {active ? (
        <InsetGroup wide footer={retryLeave ? 'Leaving did not finish. Try again.' : undefined}>
          <DestructiveRow label={retryLeave ? 'Try leaving again' : 'Leave this workspace'} onClick={() => (retryLeave ? void leave() : setConfirming({ kind: 'leave' }))} />
        </InsetGroup>
      ) : null}

      {/* Stop sharing (§8.6): owners only, confirmed. */}
      {active && detail.owner ? (
        <InsetGroup wide>
          <DestructiveRow label="Stop sharing" onClick={() => setConfirming({ kind: 'stop' })} />
        </InsetGroup>
      ) : null}

      {/* Keep as my own copy (C1): the way out of a share that is dead here. Local only, confirmed. */}
      {forgettable ? (
        <InsetGroup wide footer="Keeps everything here as a workspace of your own. Nobody else's copy is touched.">
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
          title="Keep as your own copy?"
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
              void run(() => sync.stopSharing(book.id));
            },
          }}
        >
          <p className="text-[15px] leading-[20px]">{stopConfirm(book.name)}</p>
        </Sheet>
      ) : null}
    </div>
  );
}

/**
 * Share net worth (joint-net-worth spec §6, §8.1): the row and its states — none (opens the setup), waiting for the
 * others (the proposer may cancel), asked to confirm, active with its filing mode (Change filing, Stop sharing my net
 * worth) — and, once a group is active, the review of this person's items.
 */
function NetWorthSection({ bookId, detail, groupFailing }: { bookId: string; detail: SharingDetail; groupFailing: boolean }) {
  const { sync } = useApp();
  const group = useNetWorthGroup(bookId);
  const review = useReview();
  const [setup, setSetup] = useState<{ initial?: { mode: 'joint' | 'separate'; members: string[] } } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const row = netWorthRowOf(group.data, detail.members);
  if (!row.show || group.isPending) return null;

  async function run(work: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (failure) {
      setError(sayError(sayNetWorthError(failure)));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (setup) return <NetWorthSetup bookId={bookId} members={detail.members} initial={setup.initial} onDone={() => setSetup(null)} />;

  const me = group.data?.me ?? detail.memberId;
  const active = group.data?.active ?? null;
  const pending = row.pending;
  const others = (active?.members ?? []).filter((id) => id !== me).map((id) => detail.members.find((m) => m.memberId === id)?.name ?? 'Someone');
  const items = review.data?.items ?? [];
  const reviewing =
    active &&
    active.members.includes(me) &&
    review.data !== undefined &&
    needsReview({
      mode: active.mode,
      reviewed: review.data.reviewed,
      unreviewedItems: items.filter((item) => item.setting === null).length,
      pendingHidden: review.data.pending.length,
    });

  return (
    <div data-testid="net-worth-section">
      <ErrorBox error={error} />
      <InsetGroup
        wide
        header="Net worth"
        footer={
          groupFailing
            ? 'Net worth could not sync just now. It tries again on its own.'
            : pending?.kind === 'asked'
              ? 'Choose differently declines this and lets you propose your own.'
              : row.active
                ? `Shared with ${others.join(', ') || 'nobody yet'}.${row.active.mode === 'joint' ? ` ${JOINT_LINE}` : ''}`
                : 'See what your household owns and owes together. Each person chooses what of theirs to share.'
        }
      >
        {row.active ? <InsetRow testId="net-worth-status" icon={<Landmark size={15} aria-hidden />} title={row.active.line} chevron={false} /> : null}
        {!row.active && !pending ? (
          <InsetRow testId="share-net-worth" icon={<Landmark size={15} aria-hidden />} title="Share net worth" onClick={() => setSetup({})} />
        ) : null}
        {pending?.kind === 'waiting' ? <InsetRow testId="net-worth-waiting" icon={<Landmark size={15} aria-hidden />} title={pending.line} chevron={false} /> : null}
        {pending?.kind === 'waiting' && pending.cancellable ? (
          <InsetRow title="Cancel" chevron={false} disabled={busy} onClick={() => void run(() => sync.cancelNetWorth(bookId, pending.proposalId))} />
        ) : null}
        {pending?.kind === 'asked' ? <InsetRow testId="net-worth-asked" icon={<Landmark size={15} aria-hidden />} title={pending.line} chevron={false} /> : null}
        {pending?.kind === 'asked' ? (
          <InsetRow title="Confirm" chevron={false} disabled={busy} onClick={() => void run(() => sync.answerNetWorth(bookId, pending.proposalId, 'confirm'))} />
        ) : null}
        {pending?.kind === 'asked' ? (
          <InsetRow
            title="Choose differently"
            chevron={false}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await sync.answerNetWorth(bookId, pending.proposalId, 'decline');
                setSetup({});
              })
            }
          />
        ) : null}
        {row.active && !pending ? (
          <InsetRow
            title="Change filing"
            onClick={() => setSetup({ initial: { mode: row.active!.mode, members: (active?.members ?? []).filter((id) => id !== me) } })}
          />
        ) : null}
      </InsetGroup>

      {reviewing && active ? <NetWorthReview key={active.proposalId} mode={active.mode} items={items} pending={review.data?.pending ?? []} others={others} /> : null}

      {row.active ? (
        <InsetGroup wide>
          <DestructiveRow label="Stop sharing my net worth" onClick={() => setLeaving(true)} />
        </InsetGroup>
      ) : null}

      {leaving ? (
        <Sheet
          title="Stop sharing your net worth?"
          onClose={() => setLeaving(false)}
          confirm={{
            label: 'Stop sharing',
            disabled: busy,
            run: () => {
              setLeaving(false);
              void run(() => sync.leaveNetWorth(bookId));
            },
          }}
        >
          <p className="text-[15px] leading-[20px]">Your items leave the others' phones. This workspace stays shared as it is.</p>
        </Sheet>
      ) : null}
    </div>
  );
}
