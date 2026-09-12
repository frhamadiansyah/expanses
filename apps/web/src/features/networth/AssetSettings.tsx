import type { PlanGroup } from '@expanses/core';
import { setAssetGroup, setLotSize } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Select } from '../../ui';
import { PLAN_GROUP_LABELS, PLAN_GROUP_ORDER } from './labels';

/** Which side of the plan an asset counts on, and how many shares make a lot at your broker. */
export function AssetSettings({
  accountId,
  group: current,
  lotSize,
  showLotSize,
}: {
  accountId: string;
  group: PlanGroup;
  /** Null when the holding is counted in single units, or has no profile yet. */
  lotSize: number | null;
  showLotSize: boolean;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [group, setGroup] = useState<PlanGroup>(current);
  const [lots, setLots] = useState(lotSize === null ? '' : String(lotSize));
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

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
      </div>
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
