import type { RingColour } from '@expanses/core';
import { type CreatedInvite, type SharedDevice, type SharedMemberDetail, type SharingDetail, setOwnRing } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { Laptop, Link2, Pencil, Smartphone, User } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, PushedTitle, SCREEN, SubmitRow, TextRow } from '../../ui/native';
import { useBookRings } from '../networth/queries';
import { ringRowFooter } from '../networth/rings';
import { InviteCard } from './InviteCard';
import { memberNameDraft, NAME_TOO_LONG_LINE } from './member-name';
import { useBookStatus, useSharingDetail, useSyncStatus } from './queries';
import { RingColourRow, RingColourSheet } from './RingColour';
import { useActionRunner, useShareBook } from './share-hooks';
import { rememberName } from './SharingSection';
import { syncedAgo } from './sharing-copy';

type MadeInvite = { invite: CreatedInvite; kind: 'someone' | 'device'; forName?: string };

/** Under a Link a device code: where on the other device it is entered, and as whom it joins. */
export function deviceInviteFooter(forName?: string): string {
  return forName
    ? `On ${forName}’s new device, choose Add workspace › Join with a code and enter this code. It joins as ${forName}.`
    : 'On the other device, choose Add workspace › Join with a code and enter this code. It joins as the same member.';
}

/** The route's page: Share › one member. */
export function MemberPage() {
  const { bookId, memberId } = useParams({ from: '/account/workspaces/$bookId/share/members/$memberId' });
  const book = useShareBook(bookId);
  const detail = useSharingDetail(bookId);
  const member = detail.data?.members.find((each) => each.memberId === memberId) ?? null;
  return (
    <div className={SCREEN}>
      <PushedTitle title={member?.name ?? 'Member'} back="Share" backTo="/account/workspaces/$bookId/share" backParams={{ bookId }} />
      <div className="pt-[2px]" data-testid="member-page">
        {book && detail.data && member ? (
          <Member bookName={book.name} bookId={bookId} detail={detail.data} member={member} />
        ) : detail.isSuccess ? (
          <InsetGroup wide>
            <InsetRow title="That member is not here." chevron={false} />
          </InsetGroup>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Rename self (sharing resilience §10.2, D-D2): one field, prefilled with the current name; Save while it is not empty,
 * changed and at most `MEMBER_NAME_MAX` characters, trimmed. The same shape as a workspace's Name sheet.
 */
function NameSheet({ current, bookName, busy, onSave, onClose }: { current: string; bookName: string; busy: boolean; onSave: (name: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(current);
  const { name, canSave, tooLong } = memberNameDraft(draft, current);
  const ok = !busy && canSave;
  return (
    <Sheet title="Name" onClose={onClose} grouped>
      <form
        aria-label="Change name"
        onSubmit={(event) => {
          event.preventDefault();
          if (ok) onSave(name);
        }}
      >
        <InsetGroup wide footer={tooLong ? NAME_TOO_LONG_LINE : `Shown to everyone in ${bookName}.`}>
          <TextRow
            label="Name"
            data-testid="member-name-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="name"
            enterKeyHint="done"
            autoFocus
          />
        </InsetGroup>
        <InsetGroup wide>
          <SubmitRow testId="member-name-save" label="Save" disabled={!ok} />
        </InsetGroup>
      </form>
    </Sheet>
  );
}

function Member({ bookId, bookName, detail, member }: { bookId: string; bookName: string; detail: SharingDetail; member: SharedMemberDetail }) {
  const { sync, database } = useApp();
  const invalidate = useInvalidateAll();
  const live = useSyncStatus(bookId);
  const engineStatus = useBookStatus(bookId);
  const [armed, setArmed] = useState<SharedDevice | null>(null);
  const [invite, setInvite] = useState<MadeInvite | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [picking, setPicking] = useState(false);
  const { busy, error, run } = useActionRunner();
  const me = detail.members.find((each) => each.me) ?? null;
  const now = Date.now();
  const frozen = engineStatus.data?.frozen ?? false;
  const active = detail.state === 'active';
  // What an owner may do to others, and only while an owner device is left (§8.5): a frozen book offers none of it.
  const steering = active && detail.owner && !frozen;
  const mine = member.me;
  // Only this member renames themselves (D-D2), while the share is live here; a frozen book takes no rename either.
  const renamable = mine && active && !frozen;

  /*
   * Ring colour (owner rings, 12 Nov): one's own, on one's own page, while this workspace is the household's net-worth
   * group (either mode; the rings themselves draw only while it files jointly). The colours another member holds are
   * named as theirs and cannot be picked.
   */
  const bookRings = useBookRings(bookId);
  const ringColour = mine && active && bookRings ? (bookRings.rings[member.memberId] ?? null) : null;
  const taken: Partial<Record<RingColour, string>> = {};
  if (bookRings) {
    for (const other of bookRings.members) {
      const colour = bookRings.rings[other];
      if (other === member.memberId || !colour) continue;
      taken[colour] = detail.members.find((each) => each.memberId === other)?.name ?? 'Someone';
    }
  }
  const pickRing = (colour: RingColour) => {
    setPicking(false);
    void run(async () => {
      await setOwnRing(database, colour);
      // As a rename does: the workspace syncs now, and its group log with it, so the partner's phone hears it soon.
      void sync.syncNow(bookId);
      await invalidate();
    });
  };

  const rename = (name: string) => {
    setRenaming(false);
    void run(async () => {
      await sync.renameSelf(bookId, name);
      // The next share or join asks with it (SharingSection's remembered name).
      rememberName(name);
    });
  };

  return (
    <>
      <ErrorBox error={error} />

      {invite && active && !frozen ? (
        <InviteCard
          invite={invite.invite}
          bookName={bookName}
          inviterName={me?.name ?? ''}
          header={invite.kind === 'device' ? (invite.forName ? `Link a device for ${invite.forName}` : 'Link a device') : 'Invite'}
          footer={invite.kind === 'device' ? deviceInviteFooter(invite.forName) : ''}
        />
      ) : null}

      {/* With a ring colour to pick, Name and Ring colour are a group of their own, with what the ring is for under it. */}
      {ringColour ? (
        <InsetGroup wide footer={ringRowFooter(member.name)}>
          {renamable ? (
            <InsetRow testId="member-name-row" icon={<Pencil size={15} aria-hidden />} title="Name" value={member.name} disabled={busy} onClick={() => setRenaming(true)} />
          ) : null}
          <RingColourRow colour={ringColour} disabled={busy} onOpen={() => setPicking(true)} />
        </InsetGroup>
      ) : null}

      <InsetGroup wide>
        {renamable && !ringColour ? (
          <InsetRow testId="member-name-row" icon={<Pencil size={15} aria-hidden />} title="Name" value={member.name} disabled={busy} onClick={() => setRenaming(true)} />
        ) : null}
        <InsetRow icon={<User size={15} aria-hidden />} title="Role" value={member.role === 'owner' ? 'Owner' : 'Member'} chevron={false} />
        {member.devices.map((device) => {
          const removable = steering && !device.mine;
          return (
            <InsetRow
              key={device.deviceId}
              testId="sharing-device"
              label={`${device.name}, ${member.name}`}
              icon={/phone|iPhone|Android/i.test(device.name) ? <Smartphone size={15} aria-hidden /> : <Laptop size={15} aria-hidden />}
              title={device.name}
              subtitle={device.mine ? `This device · ${syncedAgo(device.seenAt ?? live.lastSyncedAt, now)}` : syncedAgo(device.seenAt, now)}
              chevron={removable}
              onClick={removable ? () => setArmed((was) => (was?.deviceId === device.deviceId ? null : device)) : undefined}
            />
          );
        })}
      </InsetGroup>

      {armed && steering ? (
        <InsetGroup wide footer={`${armed.name} stops receiving ${bookName}, and cannot read anything written after. What it already holds stays on it.`}>
          <DestructiveRow
            label={busy ? 'Removing…' : `Remove ${member.name}’s ${armed.name}`}
            onClick={() =>
              void run(async () => {
                await sync.removeDevice(bookId, armed.deviceId);
                setArmed(null);
              })
            }
          />
        </InsetGroup>
      ) : null}

      {/* Make owner (§8.5): an owner, on another member who is not one yet. Link a device (§8.3): an owner's invite, for their
          own member or, for a replaced phone, another's (fix round 1). Invite someone: an owner's, on their own page. */}
      {steering ? (
        <InsetGroup wide>
          {!mine && member.role !== 'owner' ? (
            <InsetRow label={`Make ${member.name} an owner`} title="Make owner" action disabled={busy} onClick={() => void run(() => sync.makeOwner(bookId, member.memberId))} />
          ) : null}
          <InsetRow
            label={mine ? 'Link a device' : `Link a device for ${member.name}`}
            title={mine ? 'Link a device' : `Link a device for ${member.name}`}
            action
            disabled={busy}
            onClick={() =>
              void run(async () =>
                setInvite({
                  invite: mine ? await sync.linkDevice(bookId, member.name) : await sync.linkDeviceFor(bookId, me?.name ?? '', member.memberId),
                  kind: 'device',
                  forName: mine ? undefined : member.name,
                }),
              )
            }
          />
          {mine ? (
            <InsetRow title="Invite someone" action disabled={busy} onClick={() => void run(async () => setInvite({ invite: await sync.invite(bookId, me?.name ?? ''), kind: 'someone' }))} />
          ) : null}
        </InsetGroup>
      ) : null}

      {picking && ringColour ? <RingColourSheet current={ringColour} taken={taken} busy={busy} onPick={pickRing} onClose={() => setPicking(false)} /> : null}

      {renaming && renamable ? <NameSheet current={member.name} bookName={bookName} busy={busy} onSave={rename} onClose={() => setRenaming(false)} /> : null}

      {active && mine && !steering ? (
        <InsetGroup wide>
          <InsetRow
            testId="ask-owner-to-link"
            icon={<Link2 size={15} aria-hidden />}
            title="Ask an owner to link a new device"
            subtitle={frozen ? 'No owner has a device here any more' : 'Only an owner can invite a device into this workspace'}
            chevron={false}
          />
        </InsetGroup>
      ) : null}
    </>
  );
}
