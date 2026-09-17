import { type BonusTier, type CycleBonus, minorToMajorString, parseMajor } from '@expanses/core';
import { type AccountRow, saveCycleBonus } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Select } from '../../ui';
import { CategoryOptions } from './options';
import { mergeMatch } from './rule-values';

const selected = (select: HTMLSelectElement) => Array.from(select.selectedOptions, (o) => o.value).filter(Boolean);

/** A stable key for a new bonus. Existing bonuses keep the key they were created or applied with. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'bonus';

interface TierDraft {
  spend: string;
  bonus: string;
}

/**
 * A lump awarded once per cycle for reaching a spend threshold, with the highest tier reached paying.
 *
 * Conditions this form does not show — excluded MCCs, excluded merchant keywords, currency, origin —
 * are carried through untouched, because a catalogue bonus carries several and losing them would make
 * it count spending the issuer never rewards.
 */
export function BonusForm({
  programId,
  currency,
  unit,
  accounts,
  initial,
  beforeSave,
  onDone,
}: {
  programId: string;
  currency: string;
  unit: string;
  accounts: AccountRow[];
  initial?: CycleBonus;
  beforeSave?: () => boolean;
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const major = (minor: number) => minorToMajorString(minor, currency);

  const [name, setName] = useState(initial?.name ?? '');
  const [tiers, setTiers] = useState<TierDraft[]>(
    initial && initial.tiers.length > 0
      ? initial.tiers.map((tier) => ({ spend: major(tier.minSpendMinor), bonus: String(tier.bonus) }))
      : [{ spend: '', bonus: '' }],
  );
  const [categoryIds, setCategoryIds] = useState<string[]>(initial?.match.categoryIds ?? []);
  const [excludeIds, setExcludeIds] = useState<string[]>(initial?.match.excludeCategoryIds ?? []);
  const [merchants, setMerchants] = useState((initial?.match.merchantPatterns ?? []).join(', '));
  const [validFrom, setValidFrom] = useState(initial?.validFrom ?? '');
  const [validTo, setValidTo] = useState(initial?.validTo ?? '');
  const [error, setError] = useState<unknown>(null);

  const setTier = (index: number, patch: Partial<TierDraft>) =>
    setTiers((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const parsed: BonusTier[] = tiers
        .filter((tier) => tier.spend.trim() !== '' || tier.bonus.trim() !== '')
        .map((tier) => ({ minSpendMinor: parseMajor(tier.spend, currency), bonus: Number(tier.bonus.trim()) }));
      if (parsed.length === 0) throw new Error('Add at least one tier: the spend it needs and what it pays');

      const patterns = merchants.split(',').map((s) => s.trim()).filter(Boolean);
      if (beforeSave && !beforeSave()) return;
      await saveCycleBonus(database, ws, programId, {
        id: initial?.id,
        key: initial?.key ?? slug(name),
        name,
        tiers: parsed,
        match: mergeMatch(initial?.match, { categoryIds, excludeCategoryIds: excludeIds, merchantPatterns: patterns }),
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
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Bonus name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly spend bonus" required />
        </Field>
        <div className="md:col-span-2">
          <div className="mb-1 text-xs font-semibold text-slate-600">Tiers</div>
          <p className="mb-2 text-xs text-slate-500">Spend this much in a cycle and the bonus pays. The highest tier reached is the one that pays.</p>
          {tiers.map((tier, index) => (
            <div key={index} className="mb-2 grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <Field label={`Spend at least (${currency})`}>
                <Input
                  aria-label={`Tier ${index + 1} spend`}
                  value={tier.spend}
                  onChange={(e) => setTier(index, { spend: e.target.value })}
                  inputMode="decimal"
                  placeholder="20000000"
                />
              </Field>
              <Field label={`Pays (${unit})`}>
                <Input
                  aria-label={`Tier ${index + 1} bonus`}
                  value={tier.bonus}
                  onChange={(e) => setTier(index, { bonus: e.target.value })}
                  inputMode="numeric"
                  placeholder="1000"
                />
              </Field>
              <div className="pb-1">
                {tiers.length > 1 && (
                  <Button type="button" variant="ghost" onClick={() => setTiers((rows) => rows.filter((_, i) => i !== index))}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => setTiers((rows) => [...rows, { spend: '', bonus: '' }])}>
            Add tier
          </Button>
        </div>

        <Field label="Only these categories" hint="None selected = every category. Ctrl/⌘-click for several.">
          <Select multiple size={6} value={categoryIds} onChange={(e) => setCategoryIds(selected(e.target))}>
            <CategoryOptions ownerWide accounts={accounts} kind="expense" placeholder={null} />
          </Select>
        </Field>
        <Field label="Never these categories" hint="Spending here does not count toward the threshold.">
          <Select multiple size={6} value={excludeIds} onChange={(e) => setExcludeIds(selected(e.target))}>
            <CategoryOptions ownerWide accounts={accounts} kind="expense" placeholder={null} />
          </Select>
        </Field>
        <Field label="Merchant keywords" hint="Comma-separated, matched in the description. Empty = any merchant.">
          <Input value={merchants} onChange={(e) => setMerchants(e.target.value)} placeholder="grab, gojek" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Valid from">
            <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          <Field label="Valid until">
            <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </Field>
        </div>

        <div className="md:col-span-2">
          <ErrorBox error={error} />
        </div>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit">Save bonus</Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
