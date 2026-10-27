import { useParams } from '@tanstack/react-router';
import { Landmark } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { clearDraft, draftKey, setDraft } from './net-worth-draft';
import { hiddenIds, sharedCount, sharedValue } from './net-worth-items';
import { useNetWorthGroup, useReview } from './net-worth-queries';
import { FILING_CHOICES, MODE_LABEL, namesOf, needsReview, netWorthRowOf, sayNetWorthError } from './net-worth-state';
import { NetWorthSetup } from './NetWorthSetup';
import { useSharingDetail, useSyncStatus } from './queries';
import { useShareBook } from './share-hooks';
import { sayError } from './sharing-copy';
import type { SharingDetail } from '@expanses/db';

/*
 * Share › Net worth (joint-net-worth spec §6, §8.1), one page for every state: not shared yet (the setup: filing, who
 * joins, what is shared, Invite), waiting for the others (the proposer may cancel), asked to confirm, and active (status,
 * Filing, Shared, Stop sharing my net worth). What is shared is the Shared list, a page of its own with a switch per item.
 */

/** The route's page. */
export function NetWorthPage() {
  const { bookId } = useParams({ from: '/account/workspaces/$bookId/share/net-worth' });
  const book = useShareBook(bookId);
  const detail = useSharingDetail(bookId);
  const live = useSyncStatus(bookId);
  return (
    <div className={SCREEN}>
      <PushedTitle title="Net worth" back="Share" backTo="/account/workspaces/$bookId/share" backParams={{ bookId }} />
      <div className="pt-[2px]">
        {book && detail.data ? (
          <NetWorthBody bookId={bookId} detail={detail.data} groupFailing={live.groupFailing} />
        ) : detail.isSuccess || book === null ? (
          <InsetGroup wide>
            <InsetRow title="That workspace is not shared." chevron={false} />
          </InsetGroup>
        ) : null}
      </div>
    </div>
  );
}

function NetWorthBody({ bookId, detail, groupFailing }: { bookId: string; detail: SharingDetail; groupFailing: boolean }) {
  const { sync } = useApp();
  const group = useNetWorthGroup(bookId);
  const review = useReview();
  const [changing, setChanging] = useState(false);
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

  const me = group.data?.me ?? detail.memberId;
  const active = group.data?.active ?? null;
  const pending = row.pending;

  function startChange() {
    if (!active) return;
    setDraft(draftKey(bookId, 'change'), { mode: active.mode, chosen: active.members.filter((id) => id !== me), hidden: null });
    setChanging(true);
  }

  if (changing) {
    // A Change (anything while a group is active) offers only its members (wave 3 round 2).
    return (
      <div data-testid="net-worth-section">
        <NetWorthSetup bookId={bookId} members={detail.members} change activeMembers={active?.members ?? null} onDone={() => setChanging(false)} />
      </div>
    );
  }

  // Not shared yet and nothing waiting: the setup is the page.
  if (!row.active && !pending) {
    return (
      <div data-testid="net-worth-section">
        <NetWorthSetup bookId={bookId} members={detail.members} onDone={() => {}} />
      </div>
    );
  }

  const others = (active?.members ?? []).filter((id) => id !== me).map((id) => detail.members.find((m) => m.memberId === id)?.name ?? 'Someone');
  const items = review.data?.items ?? [];
  const inGroup = Boolean(active?.members.includes(me));
  const reviewing =
    active !== null &&
    inGroup &&
    review.data !== undefined &&
    needsReview({
      mode: active.mode,
      reviewed: review.data.reviewed,
      unreviewedItems: items.filter((item) => item.setting === null).length,
      pendingHidden: review.data.pending.length,
    });
  const sharedWords = !review.data ? undefined : reviewing ? 'Review' : sharedValue(active?.mode === 'joint' ? items.length : sharedCount(items, new Set(hiddenIds(items))), items.length);

  return (
    <div data-testid="net-worth-section">
      <ErrorBox error={error} />
      {pending ? (
        <InsetGroup wide>
          {pending.kind === 'waiting' ? <InsetRow testId="net-worth-waiting" icon={<Landmark size={15} aria-hidden />} title={pending.line} chevron={false} /> : null}
          {pending.kind === 'waiting' && pending.cancellable ? (
            <InsetRow title="Cancel" action disabled={busy} onClick={() => void run(() => sync.cancelNetWorth(bookId, pending.proposalId))} />
          ) : null}
          {pending.kind === 'asked' ? (
            <InsetRow
              testId="net-worth-asked"
              icon={<Landmark size={15} aria-hidden />}
              title={pending.title}
              value={MODE_LABEL[pending.mode]}
              chevron={false}
            />
          ) : null}
          {pending.kind === 'asked' ? (
            <InsetRow title="Confirm" action disabled={busy} onClick={() => void run(() => sync.answerNetWorth(bookId, pending.proposalId, 'confirm'))} />
          ) : null}
          {pending.kind === 'asked' ? (
            <InsetRow
              title="Choose differently"
              action
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await sync.answerNetWorth(bookId, pending.proposalId, 'decline');
                  startChange();
                })
              }
            />
          ) : null}
        </InsetGroup>
      ) : null}

      {row.active ? (
        <InsetGroup wide footer={groupFailing ? 'Net worth could not sync just now. It tries again on its own.' : undefined}>
          <InsetRow testId="net-worth-status" icon={<Landmark size={15} aria-hidden />} title={`Shared with ${namesOf(others) || 'nobody yet'}`} chevron={false} />
          <InsetRow testId="net-worth-filing" title="Filing" value={FILING_CHOICES[row.active.mode]} onClick={pending ? undefined : startChange} chevron={!pending} />
          {inGroup ? (
            <InsetRow testId="networth-shared-row" title="Shared" value={sharedWords} to="/account/workspaces/$bookId/share/net-worth/items" params={{ bookId }} />
          ) : null}
        </InsetGroup>
      ) : null}

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
              clearDraft(draftKey(bookId, 'review'));
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
