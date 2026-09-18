import { hartaLabel, type PlanGroup } from '@expanses/core';
import { setAssetGroup, setAssetReporting, setLotSize } from '@expanses/db';
import { useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Select } from '../../ui';
import { CodePicker } from '../ownables/CodePicker';
import { PLAN_GROUP_LABELS, PLAN_GROUP_ORDER } from './labels';

/** Which side of the plan an asset counts on, and how many shares make a lot at your broker. */
export function AssetSettings({
  accountId,
  group: current,
  lotSize,
  showLotSize,
  reportable: currentReportable,
  coretaxCode: currentCode,
  itemId,
  taxTreatment: currentTreatment,
}: {
  accountId: string;
  group: PlanGroup;
  /** Null when the holding is counted in single units, or has no profile yet. */
  lotSize: number | null;
  showLotSize: boolean;
  reportable: boolean;
  /** Null when the asset has no profile yet. */
  coretaxCode: string | null;
  /** What this thing is, as the catalogue names it — the account's subtype. Tells two items sharing a code apart. */
  itemId?: string;
  /** How its income is taxed. Null means the owner has not said. */
  taxTreatment: 'final' | 'not_object' | 'ordinary' | null;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [group, setGroup] = useState<PlanGroup>(current);
  const [lots, setLots] = useState(lotSize === null ? '' : String(lotSize));
  const [reportable, setReportable] = useState(currentReportable);
  const [code, setCode] = useState(currentCode ?? '');
  const [treatment, setTreatment] = useState<string>(currentTreatment ?? '');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // Choosing "Type a code instead" is a request for this box; without the cursor it looks like nothing happened.
  const codeBox = useRef<HTMLInputElement>(null);

  async function save() {
    setError(null);
    setNotice('');
    setBusy(true);
    try {
      if (group !== current) await setAssetGroup(database, ws, accountId, group);
      if (showLotSize) {
        const typed = lots.trim();
        const size = typed === '' ? null : Number(typed);
        if (size !== null && !Number.isInteger(size)) throw new Error('A lot is a whole number of shares');
        if (size !== lotSize) await setLotSize(database, ws, accountId, size);
      }
      const typedCode = code.trim();
      const treatmentChanged = treatment !== (currentTreatment ?? '');
      if (reportable !== currentReportable || typedCode !== (currentCode ?? '') || treatmentChanged) {
        await setAssetReporting(database, ws, accountId, {
          reportable,
          ...(typedCode === (currentCode ?? '') ? {} : { coretaxCode: typedCode === '' ? null : typedCode }),
          ...(treatmentChanged ? { taxTreatment: treatment === '' ? null : (treatment as 'final' | 'not_object' | 'ordinary') } : {}),
        });
      }
      await invalidate();
      setNotice('Saved.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Settings</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Counts as" hint="Broker cash set to Investments is money meant to be invested, not your emergency buffer.">
          <Select value={group} onChange={(e) => setGroup(e.target.value as PlanGroup)}>
            {PLAN_GROUP_ORDER.map((key) => (
              <option key={key} value={key}>
                {PLAN_GROUP_LABELS[key]}
              </option>
            ))}
          </Select>
        </Field>
        {showLotSize && (
          <Field label="Shares in a lot" hint="100 on the IDX, 1 for US shares. Empty counts in single units.">
            <Input value={lots} inputMode="numeric" onChange={(e) => setLots(e.target.value)} placeholder="100" />
          </Field>
        )}
        <Field
          label="How its income is taxed"
          hint="A government coupon is final; a holding abroad is ordinary. A dividend you reinvest is marked on the payment itself."
        >
          <Select value={treatment} onChange={(e) => setTreatment(e.target.value)}>
            <option value="">Not set</option>
            <option value="final">Final — reported, not added to taxable income</option>
            <option value="not_object">Tidak termasuk objek pajak — no tax</option>
            <option value="ordinary">Ordinary — added to taxable income</option>
          </Select>
        </Field>
        {/* The words first, the digits second: the list answers "which of these is it?", the box takes anything else. */}
        <CodePicker flow="asset" code={code.trim()} itemId={itemId} onChange={setCode} onTypeInstead={() => codeBox.current?.focus()} disabled={!reportable} />
        <Field
          label="Tax report code"
          hint={code.trim() === '' ? 'Four digits. Empty uses the code this kind of asset normally takes.' : hartaLabel(code.trim()) || 'Not a code the form knows.'}
        >
          <Input ref={codeBox} value={code} inputMode="numeric" onChange={(e) => setCode(e.target.value)} placeholder="0109" disabled={!reportable} />
        </Field>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={reportable} onChange={(e) => setReportable(e.target.checked)} />
        <span>
          Report this as harta
          <span className="block text-xs text-slate-500">
            Turn it off for money that is yours but is not reported yet — a pension balance that counts only once it has been paid out, for
            instance. It still counts toward your net worth.
          </span>
        </span>
      </label>
      <ErrorBox error={error} />
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy}>
          Save settings
        </Button>
        {notice && <span className="text-sm text-emerald-700">{notice}</span>}
      </div>
    </Card>
  );
}
