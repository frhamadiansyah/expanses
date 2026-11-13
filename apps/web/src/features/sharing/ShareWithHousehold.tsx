import { activeNetWorthGroup, type ShareSetting, setJointAccount, setShareSetting } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, SwitchRow } from '../../ui/native';
import { useActiveNetWorthGroup, useJointAccount, useShareSetting } from './net-worth-queries';
import { newItemShared } from './net-worth-items';
import { HOUSEHOLD_SHARING, SETTING_LABEL, sayNetWorthError, settingOnAdd, shareRowOf } from './net-worth-state';

/*
 * Each item's own say in joint net worth (spec §8.1, D7, D9). Nothing at all is drawn while this person is in no active
 * group: a household that never set it up sees no trace of it.
 */

/**
 * An item page's "Household sharing" row: the stored setting as it is (review round 1, finding 3). Under One tax ID there
 * is never a picker: a shared item reads Shared (a link to Share net worth), one still hidden (D8) or never reviewed
 * reads "Not shared yet" with Share. Separately, a picker of Shared / Private.
 */
export function ShareWithHouseholdRow({ accountId, jointSwitch = false }: { accountId: string; /** The page of a money account or a credit card: the Joint switch sits under the share row, once it is shared. 'card' words it for a card. */ jointSwitch?: boolean | 'card' }) {
  const { database } = useApp();
  const invalidate = useInvalidateAll();
  const group = useActiveNetWorthGroup();
  const setting = useShareSetting(accountId);
  const jointAccount = useJointAccount(accountId);
  const [error, setError] = useState<unknown>(null);
  if (!group.data || setting.isPending) return null;
  const row = shareRowOf(group.data.mode, setting.data ?? null);

  async function change(next: ShareSetting) {
    setError(null);
    try {
      await setShareSetting(database, accountId, next);
      await invalidate();
    } catch (failure) {
      setError(sayNetWorthError(failure));
    }
  }

  async function changeJoint(on: boolean) {
    setError(null);
    try {
      await setJointAccount(database, accountId, on);
      await invalidate();
    } catch (failure) {
      setError(sayNetWorthError(failure));
    }
  }

  if (row.kind === 'not-yet-shared') {
    return (
      <>
        <ErrorBox error={error} />
        <InsetGroup>
          <InsetRow testId="share-with-household" title={HOUSEHOLD_SHARING} value={row.label} chevron={false} />
          <InsetRow title="Share" action onClick={() => void change('total')} />
        </InsetGroup>
      </>
    );
  }
  const jointRows =
    jointSwitch && (row.kind === 'plain' || (row.kind === 'choose' && row.value === 'total')) ? (
      <SwitchRow
        label={jointSwitch === 'card' ? 'Joint card' : 'Joint account'}
        checked={jointAccount.data ?? false}
        onChange={(on) => void changeJoint(on)}
        info={`With it on, the others can record into this ${jointSwitch === 'card' ? 'card' : 'account'} and the rows recorded in the shared workspace show on both phones, each with who recorded it. Either person can change or delete any of them. The ${jointSwitch === 'card' ? 'balance and statement stay' : 'balance stays'} on this phone.`}
      />
    ) : null;
  if (row.kind === 'plain') {
    // One tax ID: every item is shared, so the row only reads Shared and opens where that is decided.
    return (
      <>
        <ErrorBox error={error} />
        <InsetGroup>
          <InsetRow testId="share-with-household" title={HOUSEHOLD_SHARING} value={row.label} valueTone="gain" to="/account/workspaces/$bookId/share/net-worth" params={{ bookId: group.data.workspaceBookId }} />
          {jointRows}
        </InsetGroup>
      </>
    );
  }
  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup>
        <SelectRow label={HOUSEHOLD_SHARING} value={row.value ?? ''} onChange={(event) => event.target.value && void change(event.target.value as ShareSetting)}>
          {row.value === null ? (
            <option value="" disabled>
              {row.label}
            </option>
          ) : null}
          <option value="total">{SETTING_LABEL.total}</option>
          <option value="hidden" disabled={!row.hiddenAllowed}>
            {SETTING_LABEL.hidden}
          </option>
        </SelectRow>
        {jointRows}
      </InsetGroup>
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
  const [share, setShare] = useState(newItemShared(true) === true);
  const mode = group.data?.mode ?? null;
  const row =
    mode === null ? null : (
      <SwitchRow testId={testId} label="Shared" checked={mode === 'joint' || share} disabled={mode === 'joint'} onChange={setShare} info="Visible to the household in net worth" />
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
