import { useParams } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { shareText } from '../../native/share';
import { ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { buildName } from '../recovery/failure-record';
import { collectSyncDetails, syncDetailsText } from './sync-details';

/**
 * The route's page: Share › Details. What this device holds for the workspace's sharing and its sync log, as plain
 * text that "Copy details" copies whole — for a phone whose console nobody can read. Reads only; reachable whether
 * or not the workspace is shared here.
 */
export function SyncDetailsPage() {
  const { bookId } = useParams({ from: '/account/workspaces/$bookId/share/details' });
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
      await navigator.clipboard.writeText(text);
      setNote('Copied');
    } catch {
      // The clipboard can refuse inside the shell; the share sheet has a Copy of its own.
      try {
        const done = await shareText({ title: 'Sync details', text });
        if (done === 'copied') setNote('Copied');
      } catch (failure) {
        setError(failure);
      }
    }
  }

  return (
    <div className={SCREEN}>
      <PushedTitle title="Details" back="Share" backTo="/account/workspaces/$bookId/share" backParams={{ bookId }} />
      <div className="pt-[2px]" data-testid="sync-details">
        <ErrorBox error={error ?? details.error} />
        {details.data ? (
          <>
            <InsetGroup wide footer={`Ids are shortened. No names, amounts or keys are included.${note ? ` ${note}.` : ''}`}>
              <InsetRow testId="sync-details-copy" title="Copy details" action onClick={() => void copy(details.data)} />
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

/** The text itself, as one item of its group: the group hands every child a `position`, which a bare element would pass to the DOM. */
function DetailsText({ text }: GroupChild & { text: string }) {
  return (
    <pre data-testid="sync-details-text" className="overflow-x-auto whitespace-pre-wrap break-words px-[13px] py-[10px] font-mono text-[11.5px] leading-[15px] text-[var(--ph-ink-2)]">
      {text}
    </pre>
  );
}
