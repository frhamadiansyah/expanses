import { heldHere } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import { allowBody, allowTitle, partsLine } from './devices-copy';
import { Digits } from './Digits';
import { usePoll } from './use-self';

type Step =
  | { kind: 'starting' }
  | { kind: 'code'; sessionId: string; code: string }
  | { kind: 'confirm'; sessionId: string; digits: string; deviceName: string }
  | { kind: 'sending'; deviceName: string; progress: string }
  | { kind: 'done'; deviceName: string }
  | { kind: 'ended'; line: string };

const ENDED: Record<string, string> = {
  expired: 'The code ran out. Show a new one to try again.',
  burned: 'That code was tried too many times. Show a new one.',
  declined: 'The link was stopped.',
  mismatch: 'The other device did not answer as it should. Nothing was linked.',
};

/**
 * Account › Devices › Link another device (mockup 2026-11-19 step 3, 2026-11-21 steps 1–2): the 6-digit code, the
 * question with the 4 check digits once the new device has typed it, then the copy going up.
 */
export function LinkSheet({ onClose }: { onClose: () => void }) {
  const { self, database } = useApp();
  // What goes to the new device, said before Allow: this device's workspaces and transactions.
  const held = useQuery({ queryKey: ['link-held-here'], queryFn: () => heldHere(database) });
  const [step, setStep] = useState<Step>({ kind: 'starting' });
  const [error, setError] = useState<unknown>(null);
  const sourceName = self.info.name;

  usePoll(step.kind === 'starting', 60_000, async () => {
    try {
      const started = await self.startLinking();
      setStep({ kind: 'code', sessionId: started.sessionId, code: started.code });
    } catch (e) {
      setError(e);
    }
  });

  usePoll(step.kind === 'code', 1_500, async () => {
    if (step.kind !== 'code') return;
    const stage = await self.checkLinking(step.sessionId);
    if (stage.stage === 'confirm') setStep({ kind: 'confirm', sessionId: step.sessionId, digits: stage.digits, deviceName: stage.deviceName });
    else if (stage.stage === 'ended') setStep({ kind: 'ended', line: ENDED[stage.why] ?? ENDED.declined! });
  });

  const allow = async () => {
    if (step.kind !== 'confirm') return;
    const { sessionId, deviceName } = step;
    setStep({ kind: 'sending', deviceName, progress: '0%' });
    try {
      await self.allowLinking(sessionId, (done, total) => setStep({ kind: 'sending', deviceName, progress: partsLine(done, total) }));
      setStep({ kind: 'done', deviceName });
    } catch (e) {
      setError(e);
      setStep({ kind: 'ended', line: 'The copy could not be sent. Nothing was linked.' });
    }
  };

  const stop = async () => {
    if (step.kind === 'code' || step.kind === 'confirm') await self.declineLinking(step.sessionId).catch(() => undefined);
    onClose();
  };

  return (
    <Sheet grouped title="Link another device" onClose={() => void stop()}>
      <div data-testid="link-sheet" className="px-1">
        <ErrorBox error={error} />
        {step.kind === 'starting' && !error && <p className="py-8 text-center text-[15px] text-[var(--ph-ink-3)]">Making a code…</p>}
        {step.kind === 'code' && (
          <>
            <p className="text-center text-[15px] leading-[20px] text-[var(--ph-ink-3)]">
              On the other device: open cicis and choose <b className="text-[var(--ph-ink)]">Link to another device</b>, then type the code.
            </p>
            <Digits value={step.code} testId="link-code" gapAfter={3} />
            <p className="text-center text-[13.5px] text-[var(--ph-ink-3)]">Works for 10 minutes</p>
            <p className="mt-6 text-center text-[15px] text-[var(--ph-ink-3)]" role="status">
              Waiting for the other device…
            </p>
          </>
        )}
        {step.kind === 'confirm' && (
          <>
            <p className="mt-2 text-center text-[20px] leading-[26px] font-bold text-[var(--ph-ink)]">{allowTitle(step.deviceName)}</p>
            <p className="text-center text-[14px] text-[var(--ph-ink-3)]">Check that the {step.deviceName} shows the same numbers.</p>
            <Digits value={step.digits} testId="link-check-digits" />
            <p className="mb-5 text-center text-[14px] text-[var(--ph-ink-3)]">{allowBody(step.deviceName, sourceName, held.data)}</p>
            <InsetGroup wide>
              <InsetRow action testId="link-allow" title="Allow" onClick={() => void allow()} />
            </InsetGroup>
            <InsetGroup wide>
              <InsetRow destructive testId="link-dont-allow" title="Don’t allow" onClick={() => void stop()} />
            </InsetGroup>
          </>
        )}
        {step.kind === 'sending' && (
          <>
            <p className="mt-2 text-center text-[20px] leading-[26px] font-bold text-[var(--ph-ink)]">Sending everything to {step.deviceName}</p>
            <p className="text-center text-[14px] text-[var(--ph-ink-3)]">Keep this {sourceName} open and online.</p>
            <p className="mt-6 text-center text-[15px] text-[var(--ph-ink-3)]" role="status" data-testid="link-sending">
              {step.progress}
            </p>
          </>
        )}
        {step.kind === 'done' && (
          <>
            <p className="mt-2 text-center text-[20px] leading-[26px] font-bold text-[var(--ph-ink)]">Sent to {step.deviceName}</p>
            <p className="mb-5 text-center text-[14px] text-[var(--ph-ink-3)]">It shows everything once it has saved its own backup and opened the copy.</p>
            <InsetGroup wide>
              <InsetRow action testId="link-done" title="Done" onClick={onClose} />
            </InsetGroup>
          </>
        )}
        {step.kind === 'ended' && (
          <>
            <p className="my-6 text-center text-[15px] text-[var(--ph-ink-3)]" data-testid="link-ended">
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
