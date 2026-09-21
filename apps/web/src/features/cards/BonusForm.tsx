import { type BonusTier, type CycleBonus, minorToMajorString, parseMajor } from '@expanses/core';
import { type AccountRow, saveCycleBonus } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, TextRow } from '../../ui/native';
import { ActionRow, GroupColumns, MultiSelectRow, SubmitRow } from './rows';
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
    <form onSubmit={submit}>
      {/* The name and its tiers beside where it counts on a desktop, as the form stood in two columns before. */}
      <GroupColumns>
        <div className="min-w-0">
          <InsetGroup header={initial ? `Edit bonus · ${initial.name}` : 'New bonus'}>
            <TextRow label="Bonus name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly spend bonus" required />
          </InsetGroup>

          {/* Each tier is its own group: two figures that belong together, and the way to take the tier away. */}
          {tiers.map((tier, index) => (
            <InsetGroup
              key={index}
              header={`Tier ${index + 1}`}
              footer={index === 0 ? 'Spend this much in a cycle and the bonus pays. The highest tier reached is the one that pays.' : undefined}
            >
              <TextRow
                label={`Spend at least (${currency})`}
                aria-label={`Tier ${index + 1} spend`}
                value={tier.spend}
                onChange={(e) => setTier(index, { spend: e.target.value })}
                inputMode="decimal"
                placeholder="20000000"
              />
              <TextRow
                label={`Pays (${unit})`}
                aria-label={`Tier ${index + 1} bonus`}
                value={tier.bonus}
                onChange={(e) => setTier(index, { bonus: e.target.value })}
                inputMode="numeric"
                placeholder="1000"
              />
              {tiers.length > 1 && <DestructiveRow label="Remove" onClick={() => setTiers((rows) => rows.filter((_, i) => i !== index))} />}
            </InsetGroup>
          ))}
          <InsetGroup>
            <ActionRow label="Add tier" onClick={() => setTiers((rows) => [...rows, { spend: '', bonus: '' }])} />
          </InsetGroup>
        </div>

        <div className="min-w-0">

          <InsetGroup header="Where it counts">
            <MultiSelectRow label="Only these categories" hint="None selected = every category. Ctrl/⌘-click for several." size={6} value={categoryIds} onChange={(e) => setCategoryIds(selected(e.target))}>
              <CategoryOptions ownerWide accounts={accounts} kind="expense" placeholder={null} />
            </MultiSelectRow>
            <MultiSelectRow label="Never these categories" hint="Spending here does not count toward the threshold." size={6} value={excludeIds} onChange={(e) => setExcludeIds(selected(e.target))}>
              <CategoryOptions ownerWide accounts={accounts} kind="expense" placeholder={null} />
            </MultiSelectRow>
            <TextRow label="Merchant keywords" hint="Comma-separated, matched in the description. Empty = any merchant." value={merchants} onChange={(e) => setMerchants(e.target.value)} placeholder="grab, gojek" />
            <TextRow label="Valid from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            <TextRow label="Valid until" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </InsetGroup>

          <ErrorBox error={error} />
          <InsetGroup>
            <SubmitRow label="Save bonus" />
            <ActionRow label="Cancel" quiet onClick={onDone} />
          </InsetGroup>
        </div>
      </GroupColumns>
    </form>
  );
}
