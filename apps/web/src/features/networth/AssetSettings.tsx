import type { AssetKind, PlanGroup } from '@expanses/core';
import { renameAccount, setAssetGroup, setAssetReporting, setLotSize } from '@expanses/db';
import { type KeyboardEvent, type ReactElement, type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { errorMessage } from '../../ui';
import { InsetGroup, PickerRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { CodeSheet, WhatItIsSheet } from './CodeSheets';
import { PLAN_GROUP_LABELS } from './labels';
import { choiceForCode, codeChoices } from '../ownables/catalogue-view';
import { planGroupChoices, TAX_TREATMENT_LABELS } from './settings-model';

type Treatment = 'final' | 'not_object' | 'ordinary';

/**
 * A row's own complaint, under it in the alarm's ink: the save that row tried was refused, and the row keeps what was
 * typed so it can be put right where it was typed.
 */
export function errorHint(error: unknown): ReactNode {
  if (!error) return undefined;
  return (
    <span role="alert" className="text-[var(--ph-alarm)]">
      {errorMessage(error)}
    </span>
  );
}

/**
 * A thing's settings, as iOS keeps settings: every row is saved as it is changed — a choice when it is picked, a typed
 * row when it is left — so there is no Save to forget. A refusal is written under the row that asked.
 */
export function AssetSettings({
  accountId,
  name: currentName,
  group: current,
  assetKind,
  subtype,
  lotSize,
  showLotSize,
  reportable,
  coretaxCode: currentCode,
  taxTreatment,
  afterName,
  beforeTax,
  taxFields,
}: {
  accountId: string;
  /** What it is called; renameAccount changes it, pockets named after it included. */
  name: string;
  group: PlanGroup;
  /** What the profile says the thing is — which sides of the plan it can sensibly count on. Null with no profile. */
  assetKind: AssetKind | null;
  /** The account's subtype: what a money account is, which tells two items sharing a code apart. */
  subtype?: string;
  /** Null when the holding is counted in single units, or has no profile yet. */
  lotSize: number | null;
  showLotSize: boolean;
  reportable: boolean;
  /** Null when the asset has no profile yet, or takes its kind's usual code. */
  coretaxCode: string | null;
  /** How its income is taxed. Null means the owner has not said. */
  taxTreatment: Treatment | null;
  /** A row under Name: an asset's Acquired, which used to wait on an Edit screen of its own. */
  afterName?: ReactNode;
  /** A box between the thing's own settings and the Tax report: a money account's spending, digits and card. */
  beforeTax?: ReactNode;
  /** The tax report's own questions for it, under the Tax report group. */
  /** The report's questions for this asset, given the Tax report rows to open their box with; left out, the rows stand alone. */
  taxFields?: (lead: ReactElement[], tail: ReactElement[]) => ReactNode;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [nameText, setNameText] = useState(currentName);
  const [lots, setLots] = useState(lotSize === null ? '' : String(lotSize));
  const [sheet, setSheet] = useState<'what' | 'code' | null>(null);
  const [errors, setErrors] = useState<Record<string, unknown>>({});
  // Which of two items sharing a code was tapped — a saving account, not the current account also filed as 0102.
  const [picked, setPicked] = useState<string | null>(null);
  const code = currentCode ?? '';

  async function save(row: string, write: () => Promise<void>) {
    setErrors((was) => ({ ...was, [row]: null }));
    try {
      await write();
      await invalidate();
    } catch (e) {
      setErrors((was) => ({ ...was, [row]: e }));
    }
  }

  const saveName = () => {
    if (nameText.trim() === currentName) return;
    void save('name', () => renameAccount(database, ws, accountId, nameText));
  };
  const saveLots = () => {
    const typed = lots.trim();
    const size = typed === '' ? null : Number(typed);
    if (size === lotSize) return;
    void save('lots', async () => {
      if (size !== null && !Number.isInteger(size)) throw new Error('A lot is a whole number of shares');
      await setLotSize(database, ws, accountId, size);
    });
  };
  const saveCode = (next: string, value?: string) => {
    setSheet(null);
    setPicked(value ?? null);
    if (next === code) return;
    void save('code', () => setAssetReporting(database, ws, accountId, { coretaxCode: next === '' ? null : next }));
  };

  const chosen = choiceForCode(codeChoices('asset', code), code, picked ?? subtype);
  const groups = planGroupChoices(assetKind, subtype, current);
  const leave = (e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur();

  // Group and Description sit together under the name: where it counts in the plan, and what it is called on the report.
  const groupRow = (
        <SelectRow
          key="group"
          label="Group"
          value={current}
          onChange={(e) => void save('group', () => setAssetGroup(database, ws, accountId, e.target.value as PlanGroup))}
          info={
            subtype === 'fund'
              ? 'Broker cash set to Investments is money meant to be invested, not an emergency buffer.'
              : 'Which part of the plan this counts toward: money to hand, what is invested, what is owed, or what is lived with.'
          }
          hint={errorHint(errors.group)}
        >
          {groups.map((key) => (
            <option key={key} value={key}>
              {PLAN_GROUP_LABELS[key]}
            </option>
          ))}
        </SelectRow>
  );
  const descriptionRow = (
    <PickerRow key="description" label="Description" value={chosen?.label ?? (code === '' ? 'Not chosen' : 'A code of its own')} onOpen={() => setSheet('what')} disabled={!reportable} />
  );
  // The report's own rows, opening one Tax report box with the questions the report asks of this asset under them.
  const taxRows = [
    <SwitchRow
      key="reportable"
      label="Include in tax report"
      checked={reportable}
      onChange={(on) => void save('reportable', () => setAssetReporting(database, ws, accountId, { reportable: on }))}
      info="Turn it off for money that is held but not reported yet, such as a pension balance that counts only once it is paid out. It still counts toward net worth."
      hint={errorHint(errors.reportable)}
    />,
    // The number alone; what it stands for is in the sheet it opens.
    <PickerRow key="code" label="Tax code" value={code === '' ? 'Not chosen' : code} onOpen={() => setSheet('code')} disabled={!reportable} hint={errorHint(errors.code)} />,
  ];
  // The last row of the Tax report box: how its income is taxed is a question of the report, not of the plan.
  const incomeTax = (
        <SelectRow
          key="income-tax"
          label="Income tax"
          // "Not set" is an answer the row prints, so it has a value of its own rather than the empty one a prompt has.
          value={taxTreatment ?? 'unset'}
          onChange={(e) =>
            void save('treatment', () => setAssetReporting(database, ws, accountId, { taxTreatment: e.target.value === 'unset' ? null : (e.target.value as Treatment) }))
          }
          info="Final: reported, but not added to taxable income, as with a government bond coupon. Not a tax object: no tax at all. Ordinary: added to taxable income, as with a holding abroad. A reinvested dividend is marked on the payment itself."
          hint={errorHint(errors.treatment)}
        >
          <option value="unset">Not set</option>
          {(Object.keys(TAX_TREATMENT_LABELS) as Treatment[]).map((key) => (
            <option key={key} value={key}>
              {TAX_TREATMENT_LABELS[key]}
            </option>
          ))}
        </SelectRow>
  );
  return (
    <>
      <InsetGroup>
        <TextRow
          label="Name"
          value={nameText}
          onChange={(e) => setNameText(e.target.value)}
          onBlur={saveName}
          onKeyDown={leave}
          placeholder="Name"
          hint={errorHint(errors.name)}
        />
        {afterName}
        {showLotSize && (
          <TextRow
            label="Shares in a lot"
            value={lots}
            inputMode="numeric"
            onChange={(e) => setLots(e.target.value)}
            onBlur={saveLots}
            onKeyDown={leave}
            placeholder="Single shares"
            info="100 on the IDX, 1 for US shares. Empty counts in single shares."
            hint={errorHint(errors.lots)}
          />
        )}
        {groupRow}
        {descriptionRow}
      </InsetGroup>

      {beforeTax}

      {taxFields && reportable ? (
        taxFields(taxRows, [incomeTax])
      ) : (
        <InsetGroup header="Tax report">{[...taxRows, incomeTax]}</InsetGroup>
      )}

      {sheet === 'what' && <WhatItIsSheet code={code} itemId={picked ?? subtype} onPick={saveCode} onTypeInstead={() => setSheet('code')} onClose={() => setSheet(null)} />}
      {sheet === 'code' && <CodeSheet code={code} onSave={saveCode} onClose={() => setSheet(null)} />}
    </>
  );
}
