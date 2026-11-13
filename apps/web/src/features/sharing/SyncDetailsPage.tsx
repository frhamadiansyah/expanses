import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { shareText } from '../../native/share';
import { ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, PushedTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { buildName } from '../recovery/failure-record';
import { PlaceHeldSheet } from './PlaceHeldSheet';
import { useBookStatus, useSharingDetail, useSyncStatus } from './queries';
import { useActionRunner, useShareBook } from './share-hooks';
import { DiscardSheet } from './SharePage';
import { KEEP_OWN_LABEL, keepOwnTitle, shareStatusLine, sinceWhen } from './sharing-copy';
import { collectSyncDetails, SYNC_DETAILS_FOOTER, syncDetailsText } from './sync-details';
import type { SyncProblem } from './sync-problems';
import { useSyncState } from './sync-state';
import type { BookRow, SharingDetail } from '@expanses/db';

/*
 * Share › Sync details (redesign A1, 2026-11-13; "Details" before): plain answers first — the status, when it last
 * synced, what waits to go, Sync now — then "To fix", each problem with where it is fixed (what the Share page used to
 * show in boxes and footers), the phones in the share, and one tap further the technical log with Copy for support.
 * Reachable whether or not the workspace is shared here.
 */

export function SyncDetailsPage() {
  const { bookId } = useParams({ from: '/account/workspaces/$bookId/share/details' });
  const book = useShareBook(bookId);
  const detail = useSharingDetail(bookId);
  return (
    <div className={SCREEN}>
      <PushedTitle title="Sync details" back="Share" backTo="/account/workspaces/$bookId/share" backParams={{ bookId }} />
      <div className="pt-[2px]" data-testid="sync-details">
        {book && !detail.isPending ? <DetailsBody book={book} detail={detail.data ?? null} /> : null}
      </div>
    </div>
  );
}

type Fixing = { kind: 'discard' } | { kind: 'place' } | { kind: 'forget' } | null;

function DetailsBody({ book, detail }: { book: BookRow; detail: SharingDetail | null }) {
  const { sync } = useApp();
  const navigate = useNavigate();
  const state = useSyncState(book, detail);
  const live = useSyncStatus(book.id);
  const engine = useBookStatus(book.id);
  const [fixing, setFixing] = useState<Fixing>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  const { busy, error, run } = useActionRunner();
  const { database } = useApp();
  const [copied, setCopied] = useState<string | null>(null);
  const now = Date.now();
  const status = shareStatusLine({ status: engine.data?.status ?? null, pending: engine.isPending, error: engine.error, failing: live.failing, now });

  /** The same text the Technical log shows and copies, read now. */
  async function copySupport() {
    setCopied(null);
    await run(async () => {
      const text = syncDetailsText(await collectSyncDetails({ database, sync, bookId: book.id, build: await buildName().catch(() => null) }));
      setCopied(await copyText(text));
    });
  }

  function fix(problem: SyncProblem) {
    const how = problem.fix;
    if (!how) return undefined;
    if (how.kind === 'sync') return () => void sync.syncNow(book.id);
    if (how.kind === 'holder') return () => void navigate({ to: '/account/workspaces/$bookId', params: { bookId: how.bookId } });
    if (how.kind === 'tax') return () => void navigate({ to: '/tax-report' });
    if (how.kind === 'review') return () => void navigate({ to: '/account/workspaces/$bookId/share/what', params: { bookId: book.id } });
    return () => setFixing({ kind: how.kind });
  }

  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup wide>
        <InsetRow testId="sync-details-status" plain title="Status" value={status} chevron={false} />
        <ReadOnlyRow label="Last synced" value={state.lastSynced === null ? 'Not yet' : sinceWhen(state.lastSynced, now)} />
        {detail ? <ReadOnlyRow label="Waiting to send" value={String(detail.waiting)} /> : null}
      </InsetGroup>
      {state.active ? (
        <InsetGroup wide>
          <InsetRow testId="sync-now" title={live.running ? 'Syncing…' : 'Sync now'} action disabled={live.running} onClick={() => void sync.syncNow(book.id)} />
        </InsetGroup>
      ) : null}

      {state.problems.length > 0 || placed ? (
        <InsetGroup wide header={`To fix (${state.problems.length})`} footer={placed ?? undefined}>
          {state.problems.map((problem) => (
            <InsetRow key={problem.key} testId="sync-problem" title={problem.title} subtitle={problem.subtitle ?? undefined} onClick={fix(problem)} chevron={problem.fix !== null} />
          ))}
        </InsetGroup>
      ) : null}

      {state.phones.length > 0 ? (
        <InsetGroup wide header="Phones">
          {state.phones.map((phone) => (
            <InsetRow
              key={phone.deviceId}
              testId="sync-phone"
              title={phone.name || `${phone.owner}’s phone`}
              subtitle={[phone.mine ? 'This phone' : phone.owner, phone.version ?? 'version not known', !phone.mine && phone.seenAt ? `seen ${sinceWhen(phone.seenAt, now)}` : null, phone.outdated ? 'older version' : null]
                .filter(Boolean)
                .join(' · ')}
              chevron={false}
            />
          ))}
        </InsetGroup>
      ) : null}

      <InsetGroup wide footer={`${SYNC_DETAILS_FOOTER}${copied ? ` ${copied}.` : ''}`}>
        <InsetRow testId="sync-details-log" title="Technical log" to="/account/workspaces/$bookId/share/details/log" params={{ bookId: book.id }} />
        <InsetRow testId="sync-details-support" title="Copy details for support" action onClick={() => void copySupport()} />
      </InsetGroup>

      {fixing?.kind === 'discard' ? <DiscardSheet book={book} onClose={() => setFixing(null)} /> : null}
      {fixing?.kind === 'place' ? <PlaceHeldSheet bookId={book.id} onClose={() => setFixing(null)} onPlaced={setPlaced} /> : null}
      {fixing?.kind === 'forget' ? (
        <Sheet
          title={state.ownersQuiet ? keepOwnTitle(book.name) : 'Keep as its own copy?'}
          onClose={() => setFixing(null)}
          confirm={{
            label: KEEP_OWN_LABEL,
            disabled: busy,
            run: () => {
              setFixing(null);
              void run(() => sync.forgetSharing(book.id));
            },
          }}
        >
          <p className="text-[15px] leading-[20px]">{state.problems.find((problem) => problem.key === 'forget')?.subtitle}</p>
        </Sheet>
      ) : null}
    </>
  );
}

/**
 * Sync details › Technical log: what this device holds for the workspace's sharing and its sync log, as plain text
 * that "Copy details for support" copies whole — for a phone whose console nobody can read. Reads only.
 */
export function SyncLogPage() {
  const { bookId } = useParams({ from: '/account/workspaces/$bookId/share/details/log' });
  const { database, sync } = useApp();
  const queryClient = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const again = () => void queryClient.invalidateQueries({ queryKey: ['sync-details', bookId] });
    const stopSync = sync.subscribe(again);
    const stopLog = sync.log.subscribe(again);
    return () => {
      stopSync();
      stopLog();
    };
  }, [sync, queryClient, bookId]);
  const details = useQuery({
    queryKey: ['sync-details', bookId],
    // Read afresh on every visit: what it shows is the moment it was read, never a cached earlier one.
    gcTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => syncDetailsText(await collectSyncDetails({ database, sync, bookId, build: await buildName().catch(() => null) })),
  });

  async function copy(text: string) {
    setError(null);
    setNote(null);
    try {
      setNote(await copyText(text));
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <div className={SCREEN}>
      <PushedTitle title="Technical log" back="Sync details" backTo="/account/workspaces/$bookId/share/details" backParams={{ bookId }} />
      <div className="pt-[2px]" data-testid="sync-log">
        <ErrorBox error={error ?? details.error} />
        {details.data ? (
          <>
            <InsetGroup wide footer={`${SYNC_DETAILS_FOOTER}${note ? ` ${note}.` : ''}`}>
              <InsetRow testId="sync-details-copy" title="Copy details for support" action onClick={() => void copy(details.data)} />
            </InsetGroup>
            <InsetGroup wide>
              <DetailsText text={details.data} />
            </InsetGroup>
          </>
        ) : details.isPending ? (
          <InsetGroup wide>
            <InsetRow title="Reading…" chevron={false} />
          </InsetGroup>
        ) : null}
      </div>
    </div>
  );
}

/** Copies the details: the clipboard, or the share sheet's own Copy where the shell refuses the clipboard. "Copied" once done. */
async function copyText(text: string): Promise<string | null> {
  try {
    await navigator.clipboard.writeText(text);
    return 'Copied';
  } catch {
    const done = await shareText({ title: 'Sync details', text });
    return done === 'copied' ? 'Copied' : null;
  }
}

/** The text itself, as one item of its group: the group hands every child a `position`, which a bare element would pass to the DOM. */
function DetailsText({ text }: GroupChild & { text: string }) {
  return (
    <pre data-testid="sync-details-text" className="overflow-x-auto whitespace-pre-wrap break-words px-[13px] py-[10px] font-mono text-[11.5px] leading-[15px] text-[var(--ph-ink-2)]">
      {text}
    </pre>
  );
}
