import type { BookRow, SharedBookSummary, SharingDetail } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { Laptop, Link2, RefreshCw, Smartphone, Users } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { ErrorBox } from '../../ui';
import { DESK_BTN, DeskGroup, DeskIcon, DeskRow, PaneTitle } from '../account/desk-rows';
import { AddWorkspaceSheet } from '../account/AddWorkspaceSheet';
import { NewWorkspaceSheet } from '../workspaces/NewWorkspaceSheet';
import { useArchivedBooks, useBooks } from '../workspaces/queries';
import { WorkspaceDot } from '../workspaces/WorkspaceBadge';
import { InviteCard } from './InviteCard';
import { JoinSheet } from './JoinSheet';
import { deviceInviteFooter } from './MemberPage';
import { useBookStatus, useSharedBooks, useSharingDetail, useSyncStatus } from './queries';
import { SHARE_LIST_COPY, sharedSummary } from './share-list';
import { joinedOthers, useShareList } from './ShareListPage';
import { EXPLAINER } from './SharePage';
import { useActionRunner, useShareBook } from './share-hooks';
import { syncedAgo } from './sharing-copy';
import { useSyncState } from './sync-state';

/*
 * The Mac's Settings › Workspaces & sharing, and each shared workspace's household devices under › Devices (Mac
 * Settings and Tools, A). Each row reads what the phone's Account and Share pages read, and opens their pages; the one action done in place — Link a device — is the
 * member page's own call (`sync.linkDevice`), its code shown in the same invite card.
 */

/** "Rina", "Rina and Andi", "Rina, Andi and Sari". */
function names(list: readonly string[]): string {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** One workspace: its letter, name and line; the body opens its page, Open (or "open now ✓") beside it. */
function WorkspaceRow({ book, summary, current, busy, onSwitch }: { book: BookRow; summary: SharedBookSummary | undefined; current: boolean; busy: boolean; onSwitch: () => void }) {
  const live = useSyncStatus(book.id);
  const shared = summary?.state === 'active';
  const others = (summary?.members ?? []).filter((member) => member.memberId !== summary?.memberId).map((member) => member.name);
  // Only what is known: who it is shared with, and a sync this app has seen finish.
  const line = shared ? [others.length > 0 ? `shared with ${names(others)}` : 'shared', live.lastSyncedAt !== null ? syncedAgo(live.lastSyncedAt, Date.now()) : null].filter(Boolean).join(' · ') : 'on this device';
  return (
    <DeskRow
      testId="account-workspace"
      bodyTestId="workspace-open"
      lead={<WorkspaceDot book={book} size={26} />}
      title={book.name}
      subtitle={`${book.baseCurrency} · ${line}`}
      to="/account/workspaces/$bookId"
      params={{ bookId: book.id }}
      right={
        current ? (
          <span data-testid="workspace-switch" aria-current="true" className="text-[12.5px] whitespace-nowrap text-[var(--ph-ink-3)]">
            open now ✓
          </span>
        ) : (
          <button type="button" data-testid="workspace-switch" aria-label={`Open ${book.name}`} className={DESK_BTN} disabled={busy} onClick={onSwitch}>
            Open
          </button>
        )
      }
    />
  );
}

/** "{name} is shared with": the members, each with their devices; What is shared; the Share page for the rest. */
function SharedWith({ book, detail }: { book: BookRow; detail: SharingDetail }) {
  const frozen = useBookStatus(book.id).data?.frozen ?? false;
  const shareList = useShareList(book.id).list;
  const joined = joinedOthers(detail);
  const now = Date.now();
  return (
    <DeskGroup title={`${book.name} is shared with`} footer={EXPLAINER[1]} testId="settings-shared-with">
      {detail.members.map((member) => {
        const devices = member.devices.map((device) => (device.mine ? 'this device' : device.name));
        // Last heard from: only another member's device that has been (this device's own is under Devices).
        const seen = member.me ? null : Math.max(0, ...member.devices.map((device) => device.seenAt ?? 0)) || null;
        return (
          <DeskRow
            key={member.memberId}
            testId="sharing-member"
            lead={
              <span aria-hidden className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[12px] font-semibold text-[var(--ph-ink-2)]">
                {member.name.slice(0, 1).toUpperCase()}
              </span>
            }
            title={`${member.name}${member.role === 'owner' ? ' · owner' : ''}`}
            subtitle={member.devices.length === 0 ? 'not joined yet' : undefined}
            to="/account/workspaces/$bookId/share/members/$memberId"
            params={{ bookId: book.id, memberId: member.memberId }}
            right={devices.length > 0 ? <span className="truncate">{[names(devices), seen !== null ? syncedAgo(seen, now) : null].filter(Boolean).join(' · ')}</span> : undefined}
          />
        );
      })}
      {joined.length === 0 && <DeskRow quiet title="Waiting for someone to join" />}
      {!frozen && joined.length > 0 && (
        <DeskRow
          testId="share-list-row"
          title="What is shared"
          right={
            <>
              <span className="truncate">{shareList ? sharedSummary(shareList) : ''}</span>
              <Link to="/account/workspaces/$bookId/share/what" params={{ bookId: book.id }} className={DESK_BTN} aria-label={`Change ${SHARE_LIST_COPY.title(joined.map((member) => member.name), book.name)}`}>
                Change…
              </Link>
            </>
          }
        />
      )}
      <DeskRow title="Sharing settings" subtitle="Invite someone, sync, leave or stop sharing" to="/account/workspaces/$bookId/share" params={{ bookId: book.id }} />
    </DeskGroup>
  );
}

/** The open workspace's sharing: who it is shared with, or the way to share it. */
function OpenWorkspaceSharing({ book }: { book: BookRow }) {
  const detail = useSharingDetail(book.id);
  if (detail.isPending) return null;
  if (detail.data?.state === 'active') return <SharedWith book={book} detail={detail.data} />;
  return (
    <DeskGroup title="Sharing" footer={EXPLAINER[0]}>
      <DeskRow
        lead={<DeskIcon icon={Users} tint="#007aff" />}
        title={`Share ${book.name}`}
        subtitle={detail.data ? 'Not shared on this device now' : 'Off'}
        right={
          <Link to="/account/workspaces/$bookId/share" params={{ bookId: book.id }} className={DESK_BTN}>
            Share…
          </Link>
        }
      />
    </DeskGroup>
  );
}

export function DeskWorkspaces() {
  const { ws, switchBook } = useApp();
  const books = useBooks();
  const archived = useArchivedBooks();
  const shared = useSharedBooks().data ?? [];
  const [adding, setAdding] = useState(false);
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const open = (books.data ?? []).find((book) => book.id === ws.bookId);

  // The phone's switch, as it is: the Account page's own.
  async function choose(bookId: string) {
    if (bookId === ws.bookId) return;
    setBusy(true);
    setError(null);
    try {
      await switchBook(bookId);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="settings-workspaces">
      <PaneTitle>Workspaces & sharing</PaneTitle>
      <div className="mb-[12px] empty:hidden">
        <ErrorBox error={error} />
      </div>
      <DeskGroup title="Workspaces">
        {(books.data ?? []).map((book) => (
          <WorkspaceRow key={book.id} book={book} summary={shared.find((each) => each.bookId === book.id)} current={book.id === ws.bookId} busy={busy} onSwitch={() => void choose(book.id)} />
        ))}
        {(archived.data ?? []).map((book) => (
          <DeskRow
            key={book.id}
            testId="archived-workspace"
            lead={<WorkspaceDot book={book} size={26} />}
            quiet
            title={book.name}
            subtitle={`${book.baseCurrency} · archived`}
            to="/account/workspaces/$bookId"
            params={{ bookId: book.id }}
            label={`Open ${book.name}, archived`}
          />
        ))}
        <DeskRow bodyTestId="add-workspace" title={<span className="font-semibold text-[var(--mk-blue)]">＋ Add workspace</span>} label="Add workspace" onClick={() => setAdding(true)} />
      </DeskGroup>

      {open && <OpenWorkspaceSharing book={open} />}

      {adding && (
        <AddWorkspaceSheet
          onClose={() => setAdding(false)}
          onNew={() => {
            setAdding(false);
            setCreating(true);
          }}
          onJoin={() => {
            setAdding(false);
            setJoining(true);
          }}
        />
      )}
      {joining && <JoinSheet onClose={() => setJoining(false)} />}
      {creating && <NewWorkspaceSheet onClose={() => setCreating(false)} />}
    </div>
  );
}

/** One shared workspace's devices: whose each is and when it was last heard from, Sync, and Link a device. */
export function BookDevices({ bookId }: { bookId: string }) {
  const { sync } = useApp();
  const book = useShareBook(bookId);
  const detail = useSharingDetail(bookId);
  const frozen = useBookStatus(bookId).data?.frozen ?? false;
  const { busy, error, run } = useActionRunner();
  const [code, setCode] = useState<Awaited<ReturnType<typeof sync.linkDevice>> | null>(null);
  if (!book || !detail.data || detail.data.state !== 'active') return null;
  const data = detail.data;
  const me = data.members.find((member) => member.me) ?? null;
  const steering = data.owner && !frozen;
  return (
    <>
      <DeskGroup title={book.name} testId="settings-devices-book">
        {data.members.flatMap((member) =>
          member.devices.map((device) => (
            <DeskRow
              key={device.deviceId}
              testId="sharing-device"
              lead={<DeskIcon icon={/phone|iPhone|Android/i.test(device.name) ? Smartphone : Laptop} tint="#8e8e93" />}
              title={device.name}
              subtitle={device.mine ? `${member.name} · this device` : member.name}
              to="/account/workspaces/$bookId/share/members/$memberId"
              params={{ bookId, memberId: member.memberId }}
              right={device.seenAt !== null ? <span>{syncedAgo(device.seenAt, Date.now())}</span> : undefined}
            />
          )),
        )}
        <SyncRow book={book} detail={data} />
        {steering && me ? (
          <DeskRow
            lead={<DeskIcon icon={Link2} tint="#34c759" />}
            title="Link a device"
            subtitle="Another device of this member's, joining with a code"
            right={
              <button type="button" className={DESK_BTN} disabled={busy} onClick={() => void run(async () => setCode(await sync.linkDevice(bookId, me.name)))}>
                Link a device…
              </button>
            }
          />
        ) : (
          <DeskRow testId="ask-owner-to-link" quiet lead={<DeskIcon icon={Link2} tint="#8e8e93" />} title="Ask an owner to link a new device" subtitle={frozen ? 'No owner has a device here any more' : 'Only an owner can invite a device into this workspace'} />
        )}
      </DeskGroup>
      <div className="mb-[12px] empty:hidden">
        <ErrorBox error={error} />
      </div>
      {code && steering && (
        <div className="mb-[20px]">
          <InviteCard invite={code} bookName={book.name} inviterName={me?.name ?? ''} header="Link a device" footer={deviceInviteFooter()} />
        </div>
      )}
    </>
  );
}

/** Sync: "Up to date", "3 waiting to send", or a red count of what needs fixing — all of it on Sync details. */
function SyncRow({ book, detail }: { book: BookRow; detail: SharingDetail }) {
  const state = useSyncState(book, detail);
  const count = state.problems.length;
  return (
    <DeskRow
      testId="sharing-sync-row"
      lead={<DeskIcon icon={RefreshCw} tint={count > 0 ? '#ff3b30' : '#007aff'} />}
      title="Sync"
      subtitle={state.lastSynced !== null ? syncedAgo(state.lastSynced, Date.now()) : undefined}
      to="/account/workspaces/$bookId/share/details"
      params={{ bookId: book.id }}
      label={count > 0 ? `Sync, ${count} to fix` : `Sync, ${state.value}`}
      right={<span className={count > 0 ? 'font-semibold text-[var(--ph-alarm)]' : undefined}>{count > 0 ? `${count} to fix` : state.value}</span>}
    />
  );
}
