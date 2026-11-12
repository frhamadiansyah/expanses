import type { PlanGroup } from '@expanses/core';
import { setMoneyAccountKind, setPocketedIdentity } from '@expanses/db';
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
import { descriptionPick, planGroupChoices } from './settings-model';

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
  const [errors, setErrors] = useState<Record<string, unknown>>({});

  const pocketIds = (accounts.data ?? []).filter((row) => row.parentId === accountId).map((row) => row.id);
  const profile = [...pocketIds, accountId].map((id) => (profiles.data ?? []).find((row) => row.accountId === id)).find((row) => row !== undefined);
  const group: PlanGroup = profile?.planGroup ?? 'liquid';
  const code = profile?.coretaxCode ?? '';
  const reportable = profile?.reportable ?? true;

  const save = async (row: string, change: Parameters<typeof setPocketedIdentity>[3], kind?: 'bank' | 'savings') => {
    setErrors((was) => ({ ...was, [row]: null }));
    try {
      // The account and every pocket change kind together; the code, if it changed too, is kept by every pocket.
      if (kind) await setMoneyAccountKind(database, ws, accountId, kind);
      if (Object.keys(change).length > 0) await setPocketedIdentity(database, ws, accountId, change);
      await invalidate();
    } catch (e) {
      setErrors((was) => ({ ...was, [row]: e }));
    }
  };
  // A current and a saving account share 0102, so picking the other one changes the account's kind, not its code.
  const saveCode = (next: string, value?: string) => {
    setSheet(null);
    const pick = descriptionPick({ code, subtype }, next, value);
    if (pick.coretaxCode === undefined && pick.kind === undefined) return;
    void save('code', pick.coretaxCode === undefined ? {} : { coretaxCode: pick.coretaxCode }, pick.kind);
  };
  const chosen = choiceForCode(codeChoices('asset', code), code, subtype);
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
      {sheet === 'what' && <WhatItIsSheet code={code} itemId={subtype} onPick={saveCode} onTypeInstead={() => setSheet('code')} onClose={() => setSheet(null)} />}
      {sheet === 'code' && <CodeSheet code={code} onSave={saveCode} onClose={() => setSheet(null)} />}
    </>
  );
}
