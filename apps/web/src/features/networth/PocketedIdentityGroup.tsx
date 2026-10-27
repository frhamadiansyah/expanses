import type { PlanGroup } from '@expanses/core';
import { setPocketedIdentity } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { InsetGroup, PickerRow, SelectRow } from '../../ui/native';
import { SettingsNameRow } from '../accounts/SettingsNameRow';
import { choiceForCode, codeChoices } from '../ownables/catalogue-view';
import { errorHint } from './AssetSettings';
import { CodeSheet, WhatItIsSheet } from './CodeSheets';
import { PLAN_GROUP_LABELS } from './labels';
import { useAssetProfiles } from './queries';
import { planGroupChoices } from './settings-model';

/**
 * A bank or saving account with pockets, named as a plain one is: Bank › name, then Group and Description. They are the
 * account's, not a pocket's — a pocket is named from the account's name and its currency — so they are asked here, once,
 * and kept by every pocket (`setPocketedIdentity`), which is what the reports read.
 *
 * Shown from the first pocket that has a profile (the one the reports read), else the account's own.
 */
export function PocketedIdentityGroup({ accountId, subtype }: { accountId: string; subtype: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const profiles = useAssetProfiles();
  const [sheet, setSheet] = useState<'what' | 'code' | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, unknown>>({});

  const pocketIds = (accounts.data ?? []).filter((row) => row.parentId === accountId).map((row) => row.id);
  const profile = [...pocketIds, accountId].map((id) => (profiles.data ?? []).find((row) => row.accountId === id)).find((row) => row !== undefined);
  const group: PlanGroup = profile?.planGroup ?? 'liquid';
  const code = profile?.coretaxCode ?? '';
  const reportable = profile?.reportable ?? true;

  const save = async (row: string, change: Parameters<typeof setPocketedIdentity>[3]) => {
    setErrors((was) => ({ ...was, [row]: null }));
    try {
      await setPocketedIdentity(database, ws, accountId, change);
      await invalidate();
    } catch (e) {
      setErrors((was) => ({ ...was, [row]: e }));
    }
  };
  const saveCode = (next: string, value?: string) => {
    setSheet(null);
    setPicked(value ?? null);
    if (next === code) return;
    void save('code', { coretaxCode: next === '' ? null : next });
  };
  const chosen = choiceForCode(codeChoices('asset', code), code, picked ?? subtype);
  const groups = planGroupChoices(profile?.assetKind ?? null, subtype, group);

  return (
    <>
      <InsetGroup>
        <SettingsNameRow accountId={accountId} info="Renaming it renames its pockets." />
        <SelectRow
          label="Group"
          value={group}
          onChange={(e) => void save('group', { planGroup: e.target.value as PlanGroup })}
          info="Which part of the plan this counts toward: money to hand, what is invested, what is owed, or what is lived with."
          hint={errorHint(errors.group)}
        >
          {groups.map((key) => (
            <option key={key} value={key}>
              {PLAN_GROUP_LABELS[key]}
            </option>
          ))}
        </SelectRow>
        <PickerRow
          label="Description"
          value={chosen?.label ?? (code === '' ? 'Not chosen' : 'A code of its own')}
          onOpen={() => setSheet('what')}
          disabled={!reportable}
          hint={errorHint(errors.code)}
        />
      </InsetGroup>
      {sheet === 'what' && <WhatItIsSheet code={code} itemId={picked ?? subtype} onPick={saveCode} onTypeInstead={() => setSheet('code')} onClose={() => setSheet(null)} />}
      {sheet === 'code' && <CodeSheet code={code} onSave={saveCode} onClose={() => setSheet(null)} />}
    </>
  );
}
