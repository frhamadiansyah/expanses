import { type EarnRule, minorToMajorString, parseMajor } from '@expanses/core';
import { type AccountRow, saveEarnRule } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Select } from '../../ui';
import { CategoryOptions } from './options';
import { mergeMatch, parseRulePoints } from './rule-values';

const optionalMinor = (value: string, currency: string) => (value.trim() ? parseMajor(value, currency) : null);
const optionalInt = (value: string) => {
  if (!value.trim()) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`"${value}" must be a whole number`);
  return n;
};
const selected = (select: HTMLSelectElement) => Array.from(select.selectedOptions, (o) => o.value).filter(Boolean);

/** suggestBase pre-fills a typical base earn rate for a card's first rule. */
export function RuleForm({
  programId,
  currency,
  accounts,
  initial,
  suggestBase = false,
  beforeSave,
  onDone,
}: {
  programId: string;
  currency: string;
  accounts: AccountRow[];
  initial?: EarnRule;
  suggestBase?: boolean;
  /** Return false to cancel saving, e.g. when the user declines customising a catalogue card. */
  beforeSave?: () => boolean;
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const major = (minor: number | null | undefined) => (minor == null ? '' : minorToMajorString(minor, currency));
  const [name, setName] = useState(initial?.name ?? (suggestBase ? 'Base' : ''));
  const [points, setPoints] = useState(String(initial?.rateNum ?? 1));
  const [per, setPer] = useState(initial ? major(initial.rateDen) : suggestBase ? (currency === 'IDR' ? '2500' : '1') : '');
  const [categoryIds, setCategoryIds] = useState<string[]>(initial?.match.categoryIds ?? []);
  const [excludeIds, setExcludeIds] = useState<string[]>(initial?.match.excludeCategoryIds ?? []);
  const [merchants, setMerchants] = useState((initial?.match.merchantPatterns ?? []).join(', '));
  const [priority, setPriority] = useState(String(initial?.priority ?? 0));
  const [stackable, setStackable] = useState(initial?.stackable ?? false);
  const [rounding, setRounding] = useState<EarnRule['rounding']>(initial?.rounding ?? 'per_transaction_floor');
  const [capSpend, setCapSpend] = useState(major(initial?.capSpendMinor));
  const [capPoints, setCapPoints] = useState(initial?.capPoints == null ? '' : String(initial.capPoints));
  const [minTx, setMinTx] = useState(major(initial?.minTransactionMinor));
  const [validFrom, setValidFrom] = useState(initial?.validFrom ?? '');
  const [validTo, setValidTo] = useState(initial?.validTo ?? '');
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const rateNum = parseRulePoints(points);
      const rateDen = optionalMinor(per, currency);
      if (rateNum === null) throw new Error('Enter how many points are earned');
      if (rateDen === null || rateDen <= 0) throw new Error('Enter the spend amount that earns those points');
      const patterns = merchants.split(',').map((s) => s.trim()).filter(Boolean);
      if (beforeSave && !beforeSave()) return;
      await saveEarnRule(database, ws, programId, {
        id: initial?.id,
        name,
        priority: Number(priority) || 0,
        stackable,
        match: mergeMatch(initial?.match, { categoryIds, excludeCategoryIds: excludeIds, merchantPatterns: patterns }),
        rateNum,
        rateDen,
        rounding,
        capSpendMinor: optionalMinor(capSpend, currency),
        capPoints: optionalInt(capPoints),
        minTransactionMinor: optionalMinor(minTx, currency),
        validFrom: validFrom || null,
        validTo: validTo || null,
      });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Card className="bg-slate-50">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
        <Field label="Rule name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="5x dining" required />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Points">
            <Input value={points} onChange={(e) => setPoints(e.target.value)} inputMode="decimal" required />
          </Field>
          <Field label={`Per spend (${currency})`}>
            <Input value={per} onChange={(e) => setPer(e.target.value)} inputMode="decimal" placeholder="2500" required />
          </Field>
        </div>
        </div>

        <div className="border-t border-slate-200 pt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Where it applies</div>
          <div className="grid gap-3 md:grid-cols-2">
        <Field label="Only these categories" hint="None selected = every category. Ctrl/⌘-click for several.">
          <Select multiple size={6} value={categoryIds} onChange={(e) => setCategoryIds(selected(e.target))}>
            <CategoryOptions ownerWide accounts={accounts} kind="expense" placeholder={null} />
          </Select>
        </Field>
        <Field label="Never these categories" hint="e.g. Fees, insurance, e-wallet top-ups.">
          <Select multiple size={6} value={excludeIds} onChange={(e) => setExcludeIds(selected(e.target))}>
            <CategoryOptions ownerWide accounts={accounts} kind="expense" placeholder={null} />
          </Select>
        </Field>
        <Field label="Merchant keywords" hint="Comma-separated, matched in the description. Empty = any merchant.">
          <Input value={merchants} onChange={(e) => setMerchants(e.target.value)} placeholder="grab, gojek" />
        </Field>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Limits and validity</div>
          <div className="grid gap-3 md:grid-cols-2">
        <Field label="Priority" hint="Higher runs first. Put bonus rules above the base rule.">
          <Input value={priority} onChange={(e) => setPriority(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label={`Bonus cap: spend per cycle (${currency})`} hint="Spend beyond this falls through to lower rules.">
          <Input value={capSpend} onChange={(e) => setCapSpend(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Cap: points per cycle">
          <Input value={capPoints} onChange={(e) => setCapPoints(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label={`Minimum transaction (${currency})`}>
          <Input value={minTx} onChange={(e) => setMinTx(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Rounding" hint="Check your card terms: most floor each transaction.">
          <Select value={rounding} onChange={(e) => setRounding(e.target.value as EarnRule['rounding'])}>
            <option value="per_transaction_floor">Round down each transaction</option>
            <option value="per_cycle_sum">Sum the cycle, then round down</option>
            <option value="per_increment">Count only full multiples of the spend</option>
          </Select>
        </Field>
        <Field label="Valid from">
          <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </Field>
        <Field label="Valid until">
          <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </Field>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={stackable} onChange={(e) => setStackable(e.target.checked)} />
          Bonus on top of other rules (a promo that stacks, not a replacement rate)
        </label>
        <ErrorBox error={error} />
        <div className="flex gap-2">
          <Button type="submit">Save rule</Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
