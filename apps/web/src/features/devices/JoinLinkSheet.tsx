import { isoDate } from '@expanses/core';
import { heldHere } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { NO_SNAPSHOTS, type SnapshotStore } from '../../db/open';
import { restoreSnapshot } from '../../db/snapshots';
import { saveBytes } from '../../lib/download';
import { holdPhotosOrRefuse } from '../../photos/hold-before-restore';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, TextRow } from '../../ui/native';
import { setLastBackupAt } from '../backup/backupState';
import { partsLine, replaceWarning, sharesHere } from './devices-copy';
import { Digits } from './Digits';
import { usePoll } from './use-self';

type Step =
  | { kind: 'code' }
  | { kind: 'waiting'; sessionId: string }
  | { kind: 'confirm'; sessionId: string; digits: string }
  | { kind: 'fetching'; progress: string }
  | { kind: 'replacing' }
  | { kind: 'ended'; line: string };

const ENDED: Record<string, string> = {
  expired: 'The code ran out. Ask the other device for a new one.',
  burned: 'That code was tried too many times. Ask the other device for a new one.',
  declined: 'The other device did not allow it. Nothing here was changed.',
  mismatch: 'The other device did not answer as it should. Nothing here was changed.',
};

/** What this device holds now, for the warning: its workspaces and transactions, and what it shares with someone. */
function useHeldHere() {
  const { database } = useApp();
  return useQuery({
    queryKey: ['link-held-here'],
    queryFn: () => heldHere(database),
  });
}

/**
 * Settings › Devices › Link to another device, on the new device (mockup 2026-11-19 "type the code", 2026-11-21 step 3).
 * Nothing on this device changes until the other device allowed the link and the copy is here: then a backup file of
 * this device is saved, a safety copy kept, its photos held from the clean-up, and only then is its data replaced. The
 * next open makes the copy this device's own (self-service.ts `prepare`).
 */
export function JoinLinkSheet({ onClose }: { onClose: () => void }) {
  const { database, self, sync, safety } = useApp();
  const held = useHeldHere();
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'code' });
  const [error, setError] = useState<unknown>(null);
  const deviceName = self.info.name;
  // A backup file first unless there is truly nothing here (a fresh install); until that is known, nothing starts.
  const holdsData = held.data ? !held.data.empty : true;
  const ready = held.isSuccess;
  const sharing = held.data?.shared ?? [];

  const start = async () => {
    setError(null);
    if (!ready) return;
    try {
      if (holdsData) {
        // The backup file first, before anything is asked of the relay: this device's data, as it is now.
        const bytes = await database.exportBytes();
        await saveBytes(bytes, `cicis-${deviceName.toLowerCase()}-before-link-${isoDate()}.sqlite3`, 'application/vnd.sqlite3');
        await setLastBackupAt(database, new Date().toISOString());
      }
      const { sessionId } = await self.joinWithCode(code);
      setStep({ kind: 'waiting', sessionId });
    } catch (e) {
      setError(e);
    }
  };

  usePoll(step.kind === 'waiting' || step.kind === 'confirm', 1_500, async () => {
    if (step.kind !== 'waiting' && step.kind !== 'confirm') return;
    const stage = await self.checkJoining(step.sessionId);
    if (stage.stage === 'confirm' && step.kind === 'waiting') setStep({ kind: 'confirm', sessionId: step.sessionId, digits: stage.digits });
    else if (stage.stage === 'ended') setStep({ kind: 'ended', line: ENDED[stage.why] ?? ENDED.declined! });
    else if (stage.stage === 'allowed') void replace(step.sessionId);
  });

  const replace = async (sessionId: string) => {
    setStep({ kind: 'fetching', progress: '0%' });
    try {
      // The photos here are held from the clean-up that runs after the replace (the copy does not name them), then
      // the plan is kept outside the database, then the data is replaced: the next open finishes from the plan.
      await self.takeCopy(sessionId, {
        onProgress: (done, total) => setStep({ kind: 'fetching', progress: partsLine(done, total) }),
        onReplacing: () => setStep({ kind: 'replacing' }),
        holdPhotos: () => holdPhotosOrRefuse(),
        replace: async (bytes) => {
          const store: SnapshotStore = safety?.snapshots ?? NO_SNAPSHOTS;
          await restoreSnapshot({
            snapshots: { ...store, read: async () => bytes },
            file: 'link-copy.sqlite3',
            source: 'Link to another device',
            live: () => database.exportBytes(),
            restore: (copy) => {
              self.halt();
              return sync.whileReplacing(() => database.importBytes(copy));
            },
          });
        },
      });
      window.location.reload();
    } catch (e) {
      setError(e);
      setStep({ kind: 'ended', line: "This device's data is as it was. Try again from the other device." });
    }
  };

  const cancel = async () => {
    if (step.kind === 'waiting' || step.kind === 'confirm') await self.declineLinking(step.sessionId).catch(() => undefined);
    onClose();
  };

  return (
    <Sheet grouped title="Link to another device" onClose={() => void cancel()}>
      <div data-testid="join-link-sheet" className="px-1">
        <ErrorBox error={error} />
        {step.kind === 'code' && sharing.length > 0 && <p className="py-4 text-center text-[15px] text-[var(--ph-ink-3)]">{sharesHere(deviceName, sharing)}</p>}
        {step.kind === 'code' && sharing.length === 0 && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (ready && /^\d{6}$/.test(code.replace(/\s/g, ''))) void start();
            }}
          >
            <p className="mb-3 text-center text-[14px] text-[var(--ph-ink-3)]">Type the code shown on the other device, under Account › Devices › Link another device.</p>
            <InsetGroup wide footer={holdsData && held.data ? replaceWarning({ deviceName, workspaces: held.data.workspaces, transactions: held.data.transactions, sourceHint: 'other device' }) : undefined}>
              <TextRow label="Code" data-testid="join-link-code" inputMode="numeric" pattern="[0-9 ]*" autoComplete="one-time-code" placeholder="6 digits" className="tabular min-w-[8ch]" value={code} onChange={(event) => setCode(event.target.value.replace(/[^\d\s]/g, '').slice(0, 7))} autoFocus />
            </InsetGroup>
            <InsetGroup wide>
              <InsetRow action testId="join-link-go" title={holdsData ? 'Save backup and link' : 'Link'} disabled={!ready || !/^\d{6}$/.test(code.replace(/\s/g, ''))} onClick={() => void start()} />
            </InsetGroup>
          </form>
        )}
        {step.kind === 'waiting' && <p className="py-8 text-center text-[15px] text-[var(--ph-ink-3)]" role="status">Waiting for the other device…</p>}
        {step.kind === 'confirm' && (
          <>
            <p className="mt-2 text-center text-[17px] font-semibold text-[var(--ph-ink)]">Check the other device</p>
            <p className="text-center text-[14px] text-[var(--ph-ink-3)]">It shows these numbers too. Allow it there.</p>
            <Digits value={step.digits} testId="join-check-digits" />
            <p className="mt-2 text-center text-[15px] text-[var(--ph-ink-3)]" role="status">
              Waiting for Allow on the other device…
            </p>
          </>
        )}
        {step.kind === 'fetching' && (
          <>
            <p className="mt-2 text-center text-[20px] font-bold text-[var(--ph-ink)]">Bringing it over</p>
            <p className="text-center text-[14px] text-[var(--ph-ink-3)]">Keep both devices open and online.</p>
            <p className="mt-6 text-center text-[15px] text-[var(--ph-ink-3)]" role="status" data-testid="join-fetching">
              {step.progress}
            </p>
          </>
        )}
        {step.kind === 'replacing' && <p className="py-8 text-center text-[15px] text-[var(--ph-ink-3)]" role="status">Opening the copy…</p>}
        {step.kind === 'ended' && (
          <>
            <p className="my-6 text-center text-[15px] text-[var(--ph-ink-3)]" data-testid="join-ended">
              {step.line}
            </p>
            <InsetGroup wide>
              <InsetRow action title="Close" onClick={onClose} />
            </InsetGroup>
          </>
        )}
      </div>
    </Sheet>
  );
}
