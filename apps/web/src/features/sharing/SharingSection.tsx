import type { BookRow } from '@expanses/db';
import { Landmark, Users } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow } from '../../ui/native';
import { useNetWorthGroup, useReview } from './net-worth-queries';
import { JOINT_LINE, needsReview, netWorthRowOf, sayNetWorthError } from './net-worth-state';
import { NetWorthReview } from './NetWorthReview';
import { NetWorthSetup } from './NetWorthSetup';
import { useSharingDetail } from './queries';
import { deviceName, sayError } from './sharing-copy';
import type { SharingDetail } from '@expanses/db';

/*
 * Settings → Workspaces → a workspace → Share. The workspace page carries one row (`ShareRow`: Off or On); the pages it
 * opens are SharePage (the name and the button, then the invite and the members), MemberPage (one member, with what an
 * owner may do to them) and NetWorthPage (the Net worth section below).
 */

const NAME_KEY = 'cicis.sharing.name';

export function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // A private window: the name is simply asked for again next time.
  }
}

export const thisDeviceName = () => deviceName(navigator.userAgent, navigator.platform);

/** The workspace page's one row: whether this workspace is shared, and the way into the Share page. */
export function ShareRow({ book }: { book: BookRow }) {
  const detail = useSharingDetail(book.id);
  return (
    <InsetGroup wide>
      <InsetRow
        icon={<Users size={15} aria-hidden />}
        testId="ws-share-row"
        title="Share"
        value={detail.isPending ? undefined : detail.data ? 'On' : 'Off'}
        to="/account/workspaces/$bookId/share"
        params={{ bookId: book.id }}
      />
    </InsetGroup>
  );
}

/**
 * Share net worth (joint-net-worth spec §6, §8.1): the row and its states — none (opens the setup), waiting for the
 * others (the proposer may cancel), asked to confirm, active with its filing mode (Change filing, Stop sharing my net
 * worth) — and, once a group is active, the review of this person's items.
 */
export function NetWorthSection({ bookId, detail, groupFailing }: { bookId: string; detail: SharingDetail; groupFailing: boolean }) {
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

  if (setup) {
    // A Change (anything while a group is active) offers only its members (wave 3 round 2).
    const activeMembers = group.data?.active?.members ?? null;
    return <NetWorthSetup bookId={bookId} members={detail.members} initial={setup.initial} activeMembers={activeMembers} onDone={() => setSetup(null)} />;
  }

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
              ? 'Choose differently declines this and reopens the setup to propose something else.'
              : row.active
                ? `Shared with ${others.join(', ') || 'nobody yet'}.${row.active.mode === 'joint' ? ` ${JOINT_LINE}` : ''}`
                : 'See what the household owns and owes together. Each person chooses what of theirs to share.'
        }
      >
        {row.active ? <InsetRow testId="net-worth-status" icon={<Landmark size={15} aria-hidden />} title={row.active.line} chevron={false} /> : null}
        {!row.active && !pending ? (
          <InsetRow testId="share-net-worth" icon={<Landmark size={15} aria-hidden />} title="Share net worth" onClick={() => setSetup({})} />
        ) : null}
        {pending?.kind === 'waiting' ? <InsetRow testId="net-worth-waiting" icon={<Landmark size={15} aria-hidden />} title={pending.line} chevron={false} /> : null}
        {pending?.kind === 'waiting' && pending.cancellable ? (
          <InsetRow title="Cancel" action disabled={busy} onClick={() => void run(() => sync.cancelNetWorth(bookId, pending.proposalId))} />
        ) : null}
        {pending?.kind === 'asked' ? <InsetRow testId="net-worth-asked" icon={<Landmark size={15} aria-hidden />} title={pending.line} chevron={false} /> : null}
        {pending?.kind === 'asked' ? (
          <InsetRow title="Confirm" action disabled={busy} onClick={() => void run(() => sync.answerNetWorth(bookId, pending.proposalId, 'confirm'))} />
        ) : null}
        {pending?.kind === 'asked' ? (
          <InsetRow
            title="Choose differently"
            action
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
          title="Stop sharing net worth?"
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
          <p className="text-[15px] leading-[20px]">These items leave the others' phones. This workspace stays shared as it is.</p>
        </Sheet>
      ) : null}
    </div>
  );
}
