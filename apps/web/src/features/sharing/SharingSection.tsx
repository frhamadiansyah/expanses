import type { BookRow, CreatedInvite, SharedDevice, SharedMemberDetail, SharingDetail } from '@expanses/db';
import { Laptop, Link2, RefreshCw, Smartphone, User, UserPlus, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, SubmitRow, TextRow } from '../../ui/native';
import { InviteCard } from './InviteCard';
import { useSharingDetail, useSyncStatus } from './queries';
import { currencyRefusal, deviceName, preparing, sayError, statusLine, syncedAgo } from './sharing-copy';

/*
 * Settings → Workspaces → a workspace, the sharing rows (household sharing spec §11): Share this workspace, then the
 * status line, the members with their devices and Remove, Link a device. Make owner, Leave and Stop sharing are not
 * here yet. Every row is the native kit's own; the same section draws in the phone's sheet and the desktop's panel.
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
  const [invite, setInvite] = useState<{ invite: CreatedInvite; kind: 'someone' | 'device' } | null>(null);
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

function Shared({
  book,
  detail,
  invite,
  onInvite,
}: {
  book: BookRow;
  detail: SharingDetail;
  invite: { invite: CreatedInvite; kind: 'someone' | 'device' } | null;
  onInvite: (invite: { invite: CreatedInvite; kind: 'someone' | 'device' } | null) => void;
}) {
  const { sync } = useApp();
  const status = useSyncStatus(book.id);
  const [armed, setArmed] = useState<{ device: SharedDevice; member: SharedMemberDetail } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const me = detail.members.find((member) => member.me) ?? null;
  const mine = me?.devices.find((device) => device.mine) ?? null;
  const now = Date.now();

  const line = statusLine({
    state: detail.state,
    members: detail.members,
    me: detail.memberId,
    waiting: detail.waiting,
    lastSyncedAt: status.lastSyncedAt ?? mine?.seenAt ?? null,
    failing: status.failing,
    now,
  });

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(sayError(failure));
    } finally {
      setBusy(false);
    }
  }

  const active = detail.state === 'active';
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
      const removable = detail.owner && !device.mine;
      return (
        <InsetRow
          key={`d:${device.deviceId}`}
          testId="sharing-device"
          label={`${device.name}, ${member.name}`}
          icon={/phone|iPhone|Android/i.test(device.name) ? <Smartphone size={15} aria-hidden /> : <Laptop size={15} aria-hidden />}
          title={device.name}
          subtitle={device.mine ? `This device · ${syncedAgo(device.seenAt ?? status.lastSyncedAt, now)}` : syncedAgo(device.seenAt, now)}
          chevron={removable}
          className="pl-[28px]"
          onClick={removable ? () => setArmed((was) => (was?.device.deviceId === device.deviceId ? null : { device, member })) : undefined}
        />
      );
    }),
    // Invites are an owner's, Link a device included (spec §8.3, fix round 1): a member asks an owner instead.
    ...(member.me && active
      ? [
          detail.owner ? (
            <InsetRow
              key="link"
              className="pl-[28px]"
              icon={<Link2 size={15} aria-hidden />}
              title="Link a device"
              chevron={false}
              onClick={() => void run(async () => onInvite({ invite: await sync.linkDevice(book.id, member.name), kind: 'device' }))}
            />
          ) : (
            <InsetRow
              key="link"
              testId="ask-owner-to-link"
              className="pl-[28px]"
              icon={<Link2 size={15} aria-hidden />}
              title="Ask an owner to link a new device"
              subtitle="Only an owner can invite a device into this workspace"
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
          subtitle={active ? 'Tap to sync now' : undefined}
          chevron={false}
          onClick={active ? () => void sync.syncNow(book.id) : undefined}
        />
        {active && detail.owner ? (
          <InsetRow
            icon={<UserPlus size={15} aria-hidden />}
            title="Invite someone"
            chevron={false}
            onClick={() => void run(async () => onInvite({ invite: await sync.invite(book.id, me?.name ?? ''), kind: 'someone' }))}
          />
        ) : null}
      </InsetGroup>

      {invite && active ? (
        <InviteCard
          invite={invite.invite}
          bookName={book.name}
          inviterName={me?.name ?? ''}
          header={invite.kind === 'device' ? 'Link a device' : 'Invite'}
          footer={
            invite.kind === 'device'
              ? 'On your other device, choose Join a workspace and enter this code. It joins as you.'
              : 'Send this to the person you are sharing with. On their phone they choose Join a workspace and enter the code, or open the link.'
          }
        />
      ) : null}

      {active ? (
        <InsetGroup wide header="Members">
          {rows}
        </InsetGroup>
      ) : null}

      {armed && active ? (
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
    </div>
  );
}
