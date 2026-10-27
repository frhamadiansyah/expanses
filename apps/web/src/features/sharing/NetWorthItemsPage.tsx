import { confirmReview, type ReviewItem, setShareSetting, type ShareSetting } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, Notice, PushedTitle, SCREEN, SearchField, SwitchRow } from '../../ui/native';
import { clearDraft, draftKey, setDraft, useDraft } from './net-worth-draft';
import { byKind, filterKinds, hiddenIds, withShared } from './net-worth-items';
import { useNetWorthGroup, useReview } from './net-worth-queries';
import { JOINT_LINE, jointTaxLine, needsReview, pendingPrompt, sayNetWorthError } from './net-worth-state';
import { useSharingDetail } from './queries';

/*
 * Net worth › Shared: every asset and debt of this person with a switch, one group per kind. On is shared, off is
 * private. Before the household has agreed (the first setup) and while a new activation waits for this person's review,
 * the switches edit a draft that Invite or Share then sends; once reviewed they save at once. With one tax ID every item
 * is shared, so the switches stand on and cannot be turned off.
 */

export function NetWorthItemsPage() {
  const { bookId } = useParams({ from: '/account/workspaces/$bookId/share/net-worth/items' });
  return (
    <div className={SCREEN}>
      <PushedTitle title="Shared" back="Net worth" backTo="/account/workspaces/$bookId/share/net-worth" backParams={{ bookId }} />
      <div className="pt-[2px]">
        <ItemsBody bookId={bookId} />
      </div>
    </div>
  );
}

function ItemsBody({ bookId }: { bookId: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const detail = useSharingDetail(bookId);
  const group = useNetWorthGroup(bookId);
  const review = useReview();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const me = group.data?.me ?? detail.data?.memberId ?? '';
  const active = group.data?.active ?? null;
  const inGroup = Boolean(active?.members.includes(me));
  const newDraft = useDraft(draftKey(bookId, 'new'));
  const reviewDraft = useDraft(draftKey(bookId, 'review'));
  if (group.isPending || !review.data) return null;

  const items = review.data.items;
  const mode = inGroup ? active!.mode : newDraft.mode;
  const joint = mode === 'joint';
  const reviewing = inGroup && needsReview({ mode: active!.mode, reviewed: review.data.reviewed, unreviewedItems: items.filter((item) => item.setting === null).length, pendingHidden: review.data.pending.length });
  // A draft until someone has to be told: the first setup, and the review of an activation.
  const drafting = !inGroup || reviewing;
  const key = draftKey(bookId, inGroup ? 'review' : 'new');
  const stored = new Set(hiddenIds(items));
  const hidden = joint ? new Set<string>() : drafting ? new Set((inGroup ? reviewDraft.hidden : newDraft.hidden) ?? [...stored]) : stored;
  const others = (active?.members ?? []).filter((id) => id !== me).map((id) => detail.data?.members.find((m) => m.memberId === id)?.name ?? 'Someone');

  async function change(item: ReviewItem, shared: boolean) {
    setError(null);
    if (drafting) {
      setDraft(key, { hidden: withShared([...hidden], item.accountId, shared) });
      return;
    }
    try {
      await setShareSetting(database, item.accountId, shared ? 'total' : 'hidden');
      await invalidate();
    } catch (failure) {
      setError(sayNetWorthError(failure));
    }
  }

  async function share() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const settings: Record<string, ShareSetting> = Object.fromEntries(items.map((item) => [item.accountId, joint || !hidden.has(item.accountId) ? 'total' : 'hidden']));
      await confirmReview(database, ws, settings);
      clearDraft(key);
      await invalidate();
    } catch (failure) {
      setError(sayNetWorthError(failure));
    } finally {
      setBusy(false);
    }
  }

  const kinds = filterKinds(byKind(items), query);
  // D8: after a switch to one tax ID, only what is still hidden is asked about.
  const asking = reviewing && active!.mode === 'joint' && review.data.pending.length > 0;
  const pendingNames = items.filter((item) => review.data!.pending.includes(item.accountId)).map((item) => item.name);

  return (
    <div data-testid="net-worth-items">
      <ErrorBox error={error} />
      {reviewing ? (
        <Notice
          kind="warning"
          testId="net-worth-review"
          title="Review items"
          line={asking ? pendingPrompt(pendingNames, others) : undefined}
          body={active!.mode === 'joint' ? `${JOINT_LINE} ${jointTaxLine(others)}` : 'Each item shows its balance and one total of other use. Turn off what stays private.'}
        />
      ) : null}
      <div className="mb-3">
        <SearchField data-testid="networth-items-search" type="search" placeholder="Search" aria-label="Search items" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {kinds.map((kind) => (
        <InsetGroup key={kind.key} wide header={kind.label}>
          {kind.items.map((item) => (
            <SwitchRow
              key={item.accountId}
              testId="networth-item-switch"
              label={item.name}
              checked={!hidden.has(item.accountId)}
              disabled={joint}
              onChange={(shared) => void change(item, shared)}
            />
          ))}
        </InsetGroup>
      ))}
      {reviewing ? (
        <InsetGroup wide>
          <InsetRow testId="net-worth-share" title={busy ? 'Sharing…' : 'Share'} action disabled={busy} onClick={() => void share()} />
        </InsetGroup>
      ) : null}
    </div>
  );
}
