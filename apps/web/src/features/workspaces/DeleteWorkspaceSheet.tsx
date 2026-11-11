import { type BookDeletePlan, type BookRow } from '@expanses/db';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { eraseWidgetSummary } from '../../native/widget-summary';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, SwitchRow, TextRow } from '../../ui/native';
import { ReadRow } from '../networth/listed-trade-parts';
import { useSafetyCopy } from './safety-copy';
import { type CopyRef, useCopyRoles, useSharingDetail } from '../sharing/queries';
import { holdsForLine, isNewerLine, leftNotDeletedLine, sayError } from '../sharing/sharing-copy';
import { LeftNotDeletedError } from '../../sync/sync-service';
import {
  arrivingLine,
  DELETE_HERE_ONLY_ASK,
  DELETE_HERE_ONLY_LABEL,
  deleteCopyConfirm,
  JOIN_FIRST_WARNING,
  deleteRefusal,
  deleteStep,
  KEEP_LABEL,
  LAST_OWNER_LINE,
  leaveDeleteConfirm,
  leaveDeleteTitle,
  NOT_SENT_NOTE,
  ownPurchasesLine,
  ownRecordsLine,
} from './delete-shared';

/** Whether what was typed is the workspace's name: case and the spaces around it do not count. */
export function nameMatches(typed: string, name: string): boolean {
  return typed.trim().toLowerCase() === name.trim().toLowerCase() && name.trim() !== '';
}


/**
 * What a once-shared workspace's delete keeps (sharing resilience §5, owner decision Q1): the switch that keeps own
 * purchases (and, in a left copy, own trades and sales) in Personal, the counts from the plan, and that what is kept
 * is never sent anywhere. Nothing when there is nothing of this phone's own in it.
 */
function KeepGroup({ plan, keep, onKeep, holdsFor, newShareLikely }: { plan: BookDeletePlan; keep: boolean; onKeep: (on: boolean) => void; holdsFor: readonly CopyRef[]; newShareLikely: boolean }) {
  const arriving = plan.arrivingInShare;
  if (plan.ownPurchases === 0 && plan.ownRecords === 0 && arriving === 0) return null;
  const lines = [
    plan.ownPurchases > 0 ? ownPurchasesLine(plan.ownPurchases, keep) : null,
    plan.ownRecords > 0 ? ownRecordsLine(plan.ownRecords) : null,
    arriving > 0 ? arrivingLine(arriving, holdsFor[0]?.label ?? null) : null,
  ].filter((line): line is string => line !== null);
  // A newer share of this workspace is likely and does not wait on this copy yet (review I-3, re-review m-2): the
  // safe order is to join it before deleting this copy. A copy left for good is not told so.
  const joinFirst = keep && plan.ownPurchases > 0 && holdsFor.length === 0 && newShareLikely;
  return (
    <InsetGroup
      footer={
        <span data-testid="delete-keep-lines">
          {lines.map((line) => (
            <span key={line} className="block">
              {line}.
            </span>
          ))}
          {joinFirst ? (
            <span data-testid="delete-join-first" className="mt-[4px] block text-[var(--ph-warn)]">
              {JOIN_FIRST_WARNING}
            </span>
          ) : null}
          <span className="mt-[4px] block">{NOT_SENT_NOTE}</span>
        </span>
      }
    >
      <SwitchRow testId="delete-keep-own" label={KEEP_LABEL} checked={keep} onChange={onKeep} />
    </InsetGroup>
  );
}

/**
 * Which copy this is, where another copy of the same workspace is here (review I-2): the one whose rows a newer share
 * waits for, or the newer share itself — the wrong one to delete.
 */
function CopyLines({ holdsFor, heldBy }: { holdsFor: readonly CopyRef[]; heldBy: readonly CopyRef[] }) {
  const lines = [...holdsFor.map((ref) => holdsForLine(ref.label)), ...heldBy.map((ref) => isNewerLine(ref.label))];
  if (lines.length === 0) return null;
  return (
    <p data-testid="delete-copy-lines" className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]">
      {lines.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
    </p>
  );
}

/**
 * The way out of a workspace that holds transactions: what will go (counted), the name typed to agree, and one
 * centred row in alarm that stays grey until the name matches. A safety copy of the whole database is kept first,
 * where the platform keeps them; if that cannot be done nothing is deleted. Then the delete itself, all or nothing:
 * a never-shared workspace has everything filed in it voided; one that is or was shared — a joined copy no longer
 * shared here among them — is erased, its own purchases kept in Personal while the switch is on (§5, D-A8, D-A9).
 */
export function DeleteWorkspaceSheet({
  book,
  plan,
  onClose,
  onDeleted,
}: {
  book: BookRow;
  plan: BookDeletePlan;
  onClose: () => void;
  /** `next`: the newer share whose waiting rows this delete lets in, to land on (review I-5). */
  onDeleted: (next?: string) => Promise<void>;
}) {
  const { ws, sync } = useApp();
  const invalidate = useInvalidateAll();
  const safetyCopy = useSafetyCopy('before-delete');
  const roles = useCopyRoles(book.id).data;
  const label = roles?.label ?? book.name;
  const [typed, setTyped] = useState('');
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const refusal = deleteRefusal(plan, keep);
  const ready = nameMatches(typed, book.name) && !busy && refusal === null;

  const remove = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await safetyCopy();
      const next = roles?.holdsFor[0]?.bookId;
      await sync.deleteWorkspace(ws, book.id, { keepOwnInPersonal: keep });
      // The widget must not keep showing a deleted workspace (spec §E): erased now, written afresh for the next one.
      await eraseWidgetSummary();
      await invalidate();
      await onDeleted(next);
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  };

  return (
    <Sheet grouped tall closeOnly title="Delete workspace" onClose={onClose}>
      {plan.erases ? (
        <p data-testid="delete-erase-note" className="px-[13px] pb-[8px] text-[15px] leading-[20px]">
          {deleteCopyConfirm({ bookName: label, keep, ownPurchases: plan.ownPurchases })}
        </p>
      ) : null}
      {plan.erases ? <CopyLines holdsFor={roles?.holdsFor ?? []} heldBy={roles?.heldBy ?? []} /> : null}
      <InsetGroup>
        <ReadRow label="Workspace" value={book.name} />
        <ReadRow label="Transactions" value={String(plan.transactions)} />
        <ReadRow label="Categories" value={String(plan.categories)} />
        <ReadRow label="Budgets" value={String(plan.budgets)} />
      </InsetGroup>
      {plan.erases ? <KeepGroup plan={plan} keep={keep} onKeep={setKeep} holdsFor={roles?.holdsFor ?? []} newShareLikely={roles?.newShareLikely ?? false} /> : null}
      <InsetGroup>
        <TextRow
          label="Name"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Type the workspace’s name"
          autoCapitalize="off"
          autoCorrect="off"
          enterKeyHint="done"
        />
      </InsetGroup>
      {refusal ? (
        <p data-testid="delete-refusal" className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]">
          {refusal}
        </p>
      ) : null}
      <ErrorBox error={error} />
      <InsetGroup>
        <DestructiveRow testId="delete-everything" label="Delete everything" disabled={!ready} onClick={() => void remove()} />
      </InsetGroup>
    </Sheet>
  );
}

type LeaveStep = 'ask' | 'here-only' | 'last-owner';

/**
 * Leave and delete (§5.1, D-A8), on a joined copy still active here: one confirm, in the spec's words, naming the copy,
 * with the keep switch. `plan` is planned as if the copy were already left (review I-1), so every refusal shows before
 * the leave, which cannot be undone. A safety copy first; then this phone leaves the share and the copy is erased.
 * When the relay cannot be reached the leave changes nothing and Delete here only is asked next; the last owner is
 * told to make someone else an owner, and offered nothing else. A leave that went through over a delete that then
 * refused closes the sheet and says so (`onLeftNotDeleted`).
 */
export function LeaveAndDeleteSheet({
  book,
  plan,
  onClose,
  onDeleted,
  onLeftNotDeleted,
}: {
  book: BookRow;
  plan: BookDeletePlan;
  onClose: () => void;
  onDeleted: (next?: string) => Promise<void>;
  onLeftNotDeleted: (line: string) => void;
}) {
  const { ws, sync } = useApp();
  const invalidate = useInvalidateAll();
  const safetyCopy = useSafetyCopy('before-delete');
  const roles = useCopyRoles(book.id).data;
  const label = roles?.label ?? book.name;
  const detail = useSharingDetail(book.id).data;
  const others = (detail?.members ?? []).filter((member) => !member.me).map((member) => member.name);
  const [keep, setKeep] = useState(true);
  const [step, setStep] = useState<LeaveStep>('ask');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const refusal = deleteRefusal(plan, keep);

  const go = async (hereOnly: boolean) => {
    if (busy || refusal) return;
    setBusy(true);
    setError(null);
    try {
      if (!copied) {
        await safetyCopy();
        setCopied(true);
      }
      const next = roles?.holdsFor[0]?.bookId;
      if (hereOnly) await sync.deleteHereOnly(ws, book.id, { keepOwnInPersonal: keep });
      else await sync.leaveAndDelete(ws, book.id, { keepOwnInPersonal: keep });
      await eraseWidgetSummary();
      await invalidate();
      await onDeleted(next);
    } catch (failure) {
      if (failure instanceof LeftNotDeletedError) {
        const said = sayError(failure.cause);
        await invalidate();
        onLeftNotDeleted(leftNotDeletedLine(book.name, said instanceof Error ? said.message : String(said), failure.how));
        onClose();
        return;
      }
      const next = hereOnly ? 'error' : deleteStep(failure);
      if (next === 'error') setError(failure);
      else setStep(next);
      setBusy(false);
    }
  };

  if (step === 'last-owner') {
    return (
      <Sheet title={leaveDeleteTitle(label)} onClose={onClose}>
        <p data-testid="leave-delete-last-owner" className="text-[15px] leading-[20px]">
          {LAST_OWNER_LINE}
        </p>
      </Sheet>
    );
  }
  if (step === 'here-only') {
    return (
      <Sheet title={leaveDeleteTitle(label)} onClose={onClose} confirm={{ label: DELETE_HERE_ONLY_LABEL, disabled: busy, run: () => void go(true) }}>
        <ErrorBox error={error} />
        <p data-testid="leave-delete-here-only" className="text-[15px] leading-[20px]">
          {DELETE_HERE_ONLY_ASK}
        </p>
      </Sheet>
    );
  }
  return (
    <Sheet grouped title={leaveDeleteTitle(label)} onClose={onClose} confirm={{ label: 'Leave and delete', disabled: busy || refusal !== null, run: () => void go(false) }}>
      <p data-testid="leave-delete-confirm" className="px-[13px] pb-[8px] text-[15px] leading-[20px]">
        {leaveDeleteConfirm({ bookName: label, others, keep, ownPurchases: plan.ownPurchases })}
      </p>
      <CopyLines holdsFor={roles?.holdsFor ?? []} heldBy={roles?.heldBy ?? []} />
      <KeepGroup plan={plan} keep={keep} onKeep={setKeep} holdsFor={roles?.holdsFor ?? []} newShareLikely={roles?.newShareLikely ?? false} />
      {refusal ? (
        <p data-testid="delete-refusal" className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]">
          {refusal}
        </p>
      ) : null}
      <ErrorBox error={error} />
    </Sheet>
  );
}
