import { type EarnRule, minorToMajorString, parseMajor } from '@expanses/core';
import { type AccountRow, saveEarnRule } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { ActionRow, MultiSelectRow, SubmitRow } from './rows';
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

  // Form rows in groups, the primary action a row in the tint — the kit's form page, not a card of outlined boxes.
  return (
    <form onSubmit={submit}>
      <InsetGroup header={initial ? `Edit rule · ${initial.name}` : 'New rule'}>
        <TextRow label="Rule name" value={name} onChange={(e) => setName(e.target.value)} placeholder="5x dining" required />
        <TextRow label="Points" value={points} onChange={(e) => setPoints(e.target.value)} inputMode="decimal" required />
        <TextRow label={`Per spend (${currency})`} value={per} onChange={(e) => setPer(e.target.value)} inputMode="decimal" placeholder="2500" required />
      </InsetGroup>

      <InsetGroup header="Where it applies">
        <MultiSelectRow label="Only these categories" hint="None selected = every category. Ctrl/⌘-click for several." size={6} value={categoryIds} onChange={(e) => setCategoryIds(selected(e.target))}>
          <CategoryOptions ownerWide accounts={accounts} kind="expense" placeholder={null} />
        </MultiSelectRow>
        <MultiSelectRow label="Never these categories" hint="e.g. Fees, insurance, e-wallet top-ups." size={6} value={excludeIds} onChange={(e) => setExcludeIds(selected(e.target))}>
          <CategoryOptions ownerWide accounts={accounts} kind="expense" placeholder={null} />
        </MultiSelectRow>
        <TextRow label="Merchant keywords" hint="Comma-separated, matched in the description. Empty = any merchant." value={merchants} onChange={(e) => setMerchants(e.target.value)} placeholder="grab, gojek" />
      </InsetGroup>

      <InsetGroup header="Limits and validity">
        <TextRow label="Priority" hint="Higher runs first. Put bonus rules above the base rule." value={priority} onChange={(e) => setPriority(e.target.value)} inputMode="numeric" />
        <TextRow label={`Bonus cap: spend per cycle (${currency})`} hint="Spend beyond this falls through to lower rules." value={capSpend} onChange={(e) => setCapSpend(e.target.value)} inputMode="decimal" />
        <TextRow label="Cap: points per cycle" value={capPoints} onChange={(e) => setCapPoints(e.target.value)} inputMode="numeric" />
        <TextRow label={`Minimum transaction (${currency})`} value={minTx} onChange={(e) => setMinTx(e.target.value)} inputMode="decimal" />
        <SelectRow label="Rounding" hint="Check your card terms: most floor each transaction." value={rounding} onChange={(e) => setRounding(e.target.value as EarnRule['rounding'])}>
          <option value="per_transaction_floor">Round down each transaction</option>
          <option value="per_cycle_sum">Sum the cycle, then round down</option>
          <option value="per_increment">Count only full multiples of the spend</option>
        </SelectRow>
        <TextRow label="Valid from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        <TextRow label="Valid until" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
      </InsetGroup>

      <InsetGroup>
        <SwitchRow label="Bonus on top of other rules (a promo that stacks, not a replacement rate)" checked={stackable} onChange={setStackable} />
      </InsetGroup>
      <ErrorBox error={error} />
      <InsetGroup>
        <SubmitRow label="Save rule" />
        <ActionRow label="Cancel" quiet onClick={onDone} />
      </InsetGroup>
    </form>
  );
}
