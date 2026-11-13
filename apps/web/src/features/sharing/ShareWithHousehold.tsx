import { activeNetWorthGroup, setJointAccount, setShareSetting } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, SwitchRow, TwoPersonGlyph } from '../../ui/native';
import { chosenJoint, stoppedLine, switchItemShared, useHousehold } from './household';
import { useQuery } from '@tanstack/react-query';
import { useActiveNetWorthGroup, useShareSetting } from './net-worth-queries';
import { JOINT_SHARED_LINE, namesOf, sayNetWorthError, settingOnAdd } from './net-worth-state';

/*
 * Each item's own say in household net worth (spec §8.1, D7, D9; simplified 2026-11-13): one "Shared with Andi" switch,
 * and for a money account or a card, "Owned together" under it once it is shared. The first item switched on starts the
 * household's net worth, filed separately (`switchItemShared`). Nothing at all is drawn while there is no household —
 * no shared workspace someone joined — so a person who never shared sees no trace of it.
 */

/** The words both switches use, on every page that has them. */
export const ITEM_SHARE_COPY = {
  shared: (others: readonly string[]) => `Shared with ${namesOf(others) || 'the household'}`,
  sharedHint: (others: readonly string[]) => `${namesOf(others) || 'The household'} sees its balance in Net worth.`,
  together: 'Owned together',
  togetherHint: (others: readonly string[]) => `${namesOf(others) || 'The household'} also sees its rows and can pay from it.`,
  stopTogether: (name: string, others: readonly string[]) => ({
    title: `Stop owning ${name} together?`,
    body: `${namesOf(others) || 'The others'} will still see its balance, but not its rows, and can’t pay from it any more. Rows ${namesOf(others) || 'they'} already recorded on it stay.`,
  }),
  stopShared: (name: string, others: readonly string[]) => ({
    title: `Stop sharing ${name} with ${namesOf(others) || 'the household'}?`,
    body: `${namesOf(others) || 'The others'} will no longer see its balance or its rows, and can’t pay from it any more. Rows ${namesOf(others) || 'they'} already recorded on it stay.`,
  }),
} as const;

/**
 * An item page's two switches. `jointSwitch`: a money account or a credit card, which can be owned together. Under One
 * tax ID an item shared stays shared (D7): its switch stands on, with why.
 */
export function ShareWithHouseholdRow({ accountId, name = '', jointSwitch = false }: { accountId: string; /** The item's name, for the question before taking it back. */ name?: string; jointSwitch?: boolean | 'card' }) {
  const { database, sync, ws } = useApp();
  const invalidate = useInvalidateAll();
  const household = useHousehold();
  const setting = useShareSetting(accountId);
  // Owned together as it reads in the group; while one waits for the other phone, as chosen here (review round 1).
  const jointAccount = useQuery({ queryKey: ['net-worth', 'joint-chosen', accountId], queryFn: () => chosenJoint(database, accountId) });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<{ title: string; body: string; run: () => Promise<void> } | null>(null);
  const h = household.data;
  if (!h || h.stage === 'asked' || setting.isPending) return null;
  const others = h.others.map((other) => other.name);
  // Before any group nothing is shared, whatever an earlier one left stored; nor while the others have stopped.
  const shared = h.stage !== 'none' && h.stage !== 'stopped' && setting.data === 'total';
  const stopped = h.stage === 'stopped';
  const locked = h.mode === 'joint' && shared;
  const joint = shared && (jointAccount.data ?? false);

  async function go(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (failure) {
      setError(sayNetWorthError(failure));
    } finally {
      setBusy(false);
    }
  }

  const switchShared = (on: boolean) => go(() => switchItemShared({ database, ws, sync }, h, accountId, on));
  const switchJoint = (on: boolean) => go(() => setJointAccount(database, accountId, on));

  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup footer={locked ? JOINT_SHARED_LINE : stopped ? <span data-testid="share-stopped-line">{stoppedLine(others)}</span> : undefined}>
        <SwitchRow
          testId="share-with-household"
          label={ITEM_SHARE_COPY.shared(others)}
          hint={shared && !locked ? ITEM_SHARE_COPY.sharedHint(others) : undefined}
          checked={shared}
          disabled={busy || locked || stopped}
          onChange={(on) => {
            // Shared off on an account owned together asks once for both (mockup ③).
            if (!on && joint) setAsking({ ...ITEM_SHARE_COPY.stopShared(name || 'this account', others), run: () => switchShared(false) });
            else void switchShared(on);
          }}
        />
        {jointSwitch && shared ? (
          <SwitchRow
            testId="owned-together-switch"
            icon={<TwoPersonGlyph size={14} />}
            label={ITEM_SHARE_COPY.together}
            hint={ITEM_SHARE_COPY.togetherHint(others)}
            checked={joint}
            disabled={busy}
            onChange={(on) => {
              if (!on) setAsking({ ...ITEM_SHARE_COPY.stopTogether(name || `this ${jointSwitch === 'card' ? 'card' : 'account'}`, others), run: () => switchJoint(false) });
              else void switchJoint(true);
            }}
          />
        ) : null}
      </InsetGroup>
      {asking ? (
        <Sheet
          title={asking.title}
          onClose={() => setAsking(null)}
          confirm={{
            label: 'Stop',
            run: () => {
              const run = asking.run;
              setAsking(null);
              void run();
            },
          }}
        >
          <p data-testid="share-off-ask" className="text-[15px] leading-[20px]">
            {asking.body}
          </p>
        </Sheet>
      ) : null}
    </>
  );
}

/**
 * The add forms' part (D9, and the owner's rule that a new item starts Shared while this person's net worth sharing is
 * active): a **Shared** switch, on, as the last row of the form's main group. `row` is null when this person is in no
 * active group, so a household that never set it up sees nothing. Turning it off makes the item private; with one tax ID
 * every item is shared, so the switch stands on and cannot be turned off. `save` writes the setting for what the form
 * just opened.
 */
export function useShareOnAdd(testId = 'asset-shared-switch'): { row: ReactNode; save: (accountIds: readonly string[]) => Promise<void> } {
  const { database } = useApp();
  const group = useActiveNetWorthGroup();
  const household = useHousehold();
  // A new item starts Private (owner's spec, 2026-11-13): shared only with a tap on its switch.
  const [share, setShare] = useState(false);
  const mode = group.data?.mode ?? null;
  const row =
    mode === null ? null : (
      <SwitchRow
        testId={testId}
        label={ITEM_SHARE_COPY.shared((household.data?.others ?? []).map((other) => other.name))}
        checked={mode === 'joint' || share}
        disabled={mode === 'joint'}
        onChange={setShare}
        info={ITEM_SHARE_COPY.sharedHint((household.data?.others ?? []).map((other) => other.name))}
      />
    );
  async function save(accountIds: readonly string[]) {
    // The group as it is when the form saves, not as the screen last read it: a joint household's new item is always
    // written `total` (D9), even when the query had not loaded or the mode changed while the form was open.
    const setting = settingOnAdd((await activeNetWorthGroup(database))?.mode ?? null, share);
    if (!setting) return;
    for (const id of accountIds) await setShareSetting(database, id, setting);
  }
  return { row, save };
}
