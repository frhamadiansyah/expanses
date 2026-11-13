import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, SelectRow } from '../../ui/native';
import { useHousehold } from '../sharing/household';
import { useNetWorthGroup } from '../sharing/net-worth-queries';
import { FILING_CHOICES, type FilingMode, jointTaxLine, namesOf, netWorthRowOf, sayNetWorthError } from '../sharing/net-worth-state';
import { useSharingDetail } from '../sharing/queries';
import { sayError } from '../sharing/sharing-copy';

/*
 * How the household files (2026-11-13): the question the old Net worth setup asked first, moved to the tax report where
 * it matters. A new household starts filed separately; a change here is a proposal, as the old Filing row made, and
 * one tax ID is confirmed on the other phone — here, on that phone, with Confirm or Choose differently. Shown only while
 * this person shares net worth with someone (or is asked to).
 */

const FILING_INFO =
  "Filed together (one tax ID): the yearly return lists both, so Net worth and this report are the household's, and every item is shared. Filed separately: each keeps their own; what the other shares is seen, not counted.";

export function HouseholdFiling() {
  const household = useHousehold();
  const bookId = household.data && household.data.stage !== 'none' ? household.data.bookId : null;
  return bookId ? <FilingBody bookId={bookId} /> : null;
}

function FilingBody({ bookId }: { bookId: string }) {
  const { sync } = useApp();
  const invalidate = useInvalidateAll();
  const group = useNetWorthGroup(bookId);
  const detail = useSharingDetail(bookId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [leaving, setLeaving] = useState(false);
  const row = netWorthRowOf(group.data, detail.data?.members ?? []);
  if (!group.data || !detail.data) return null;
  const me = group.data.me;
  const active = group.data.active;
  const pending = row.pending;
  const others = (active?.members ?? group.data.pending?.members ?? []).filter((id) => id !== me).map((id) => detail.data!.members.find((m) => m.memberId === id)?.name ?? 'Someone');

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (failure) {
      setError(sayError(sayNetWorthError(failure)));
    } finally {
      setBusy(false);
    }
  }

  function change(mode: FilingMode) {
    if (!active || mode === active.mode) return;
    const ask =
      mode === 'joint'
        ? `File together with ${namesOf(others)}? Every item of both is shared and in one report. ${jointTaxLine(others)} ${namesOf(others)} confirms on their own phone.`
        : `File separately from ${namesOf(others)}? Each keeps their own report; what is shared stays shared until switched off.`;
    if (!window.confirm(ask)) return;
    void run(() => sync.proposeNetWorth(bookId, { mode, members: active.members.filter((id) => id !== me) }));
  }

  return (
    <div data-testid="household-filing">
      <ErrorBox error={error} />
      <InsetGroup header="Household" info={FILING_INFO} footer={active ? `Net worth shared with ${namesOf(others)}.` : undefined}>
        {active ? (
          <SelectRow label="Filing" data-testid="filing-select" value={active.mode} disabled={busy || pending !== null} onChange={(event) => change(event.target.value as FilingMode)}>
            <option value="separate">{FILING_CHOICES.separate}</option>
            <option value="joint">{FILING_CHOICES.joint} (one tax ID)</option>
          </SelectRow>
        ) : null}
        {pending?.kind === 'waiting' ? <InsetRow testId="filing-waiting" title={pending.line} chevron={false} /> : null}
        {pending?.kind === 'waiting' && pending.cancellable ? <InsetRow title="Cancel" action disabled={busy} onClick={() => void run(() => sync.cancelNetWorth(bookId, pending.proposalId))} /> : null}
        {pending?.kind === 'asked' ? (
          <InsetRow testId="filing-asked" title={pending.line} subtitle={pending.mode === 'joint' ? `Confirming shares every item. ${jointTaxLine(others)}` : undefined} chevron={false} />
        ) : null}
        {pending?.kind === 'asked' ? <InsetRow title="Confirm" action disabled={busy} onClick={() => void run(() => sync.answerNetWorth(bookId, pending.proposalId, 'confirm'))} /> : null}
        {pending?.kind === 'asked' ? <InsetRow title="Choose differently" action disabled={busy} onClick={() => void run(() => sync.answerNetWorth(bookId, pending.proposalId, 'decline'))} /> : null}
      </InsetGroup>
      {active ? (
        <InsetGroup>
          <DestructiveRow calm label="Stop sharing net worth" onClick={() => setLeaving(true)} />
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
          <p className="text-[15px] leading-[20px]">Every item leaves the others’ phones. The workspace stays shared as it is.</p>
        </Sheet>
      ) : null}
    </div>
  );
}
