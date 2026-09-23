import { isoDate, needsPayout } from '@expanses/core';
import { type DepositAutomationRow, saveDepositAutomation } from '@expanses/db';
import { Check } from 'lucide-react';
import { useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ReadOnlyRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { rateInputText } from './deposit-terms';
import { MATURITY_CHOICES, payoutChoices, saveQueue, taxBpsFrom } from './maturity-settings';
import { useDepositAutomation } from './queries';

/**
 * What happens at maturity, on the deposit's own page: one switch, and what the choice needs under it as soon as
 * it is on. Off is one row and changes nothing anywhere.
 */
export function MaturitySettings({ accountId, currency }: { accountId: string; currency: string }) {
  const automation = useDepositAutomation(accountId);
  if (!automation.data) return null;
  return <SettingsGroup key={accountId} saved={automation.data} currency={currency} />;
}

function SettingsGroup({ saved, currency }: { saved: DepositAutomationRow; currency: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  /*
   * The settings live here, not in the query. Each change updates this copy at once and saves the whole of it,
   * one save after another, so two quick changes can never send the older settings last.
   */
  const [settings, setSettings] = useState(saved);
  const [taxText, setTaxText] = useState(rateInputText(saved.taxBps) || '0');
  const [error, setError] = useState<unknown>(null);
  // Saves still on their way to the database: the group says so (aria-busy), so nothing reads it half-written.
  const [saving, setSaving] = useState(0);
  const queue = useRef(saveQueue());
  // The latest settings, including a change made before React re-rendered: two changes in one tick both survive.
  const latest = useRef(saved);

  const choices = payoutChoices(accounts.data ?? [], currency, settings.accountId);
  const payoutName = choices.find((account) => account.id === settings.payoutAccountId)?.name ?? null;

  function save(change: Partial<DepositAutomationRow>) {
    const next = { ...latest.current, ...change };
    latest.current = next;
    setSettings(next);
    setError(null);
    setSaving((n) => n + 1);
    void queue.current(async () => {
      try {
        await saveDepositAutomation(database, ws, {
          accountId: next.accountId,
          enabled: next.enabled,
          atMaturity: next.atMaturity,
          interestPaid: next.interestPaid,
          payoutAccountId: next.payoutAccountId,
          keepRate: next.keepRate,
          taxBps: next.taxBps,
          taxExempt: next.taxExempt,
          today: isoDate(),
        });
      } catch (e) {
        setError(e);
      } finally {
        setSaving((n) => n - 1);
      }
      // Refetching is not part of the save: the next change in the queue does not wait for the page to redraw.
      void invalidate();
    });
  }

  function commitTax() {
    try {
      const taxBps = taxBpsFrom(taxText);
      if (taxBps !== latest.current.taxBps) save({ taxBps });
    } catch (e) {
      setError(e);
    }
  }

  // Rows as an array: InsetGroup numbers its children with Children.toArray, which does not look inside a fragment.
  const rows = [
    <SwitchRow
      key="automate"
      label="Automate at maturity"
      checked={settings.enabled}
      hint="Propose it on the day; nothing posts until you confirm."
      onChange={(enabled) => save({ enabled, payoutAccountId: latest.current.payoutAccountId ?? (enabled ? (choices[0]?.id ?? null) : null) })}
    />,
  ];
  if (settings.enabled) {
    rows.push(
      ...MATURITY_CHOICES.map((choice) => (
        <InsetRow
          key={choice.id}
          testId={`maturity-${choice.id}`}
          title={choice.title}
          subtitle={choice.subtitle(payoutName)}
          value={settings.atMaturity === choice.id ? <Check size={18} aria-label="Chosen" className="text-[var(--ph-tint)]" /> : undefined}
          chevron={false}
          onClick={() =>
            save({
              atMaturity: choice.id,
              // Everything rolls over, so nothing can be paid out during the term: the two answers cannot disagree.
              ...(choice.id === 'principal_interest' ? { interestPaid: 'at_maturity' as const } : {}),
            })
          }
        />
      )),
    );
    if (needsPayout(settings.atMaturity)) {
      rows.push(
        <SelectRow key="payout" label="Lands in" value={settings.payoutAccountId ?? ''} onChange={(e) => save({ payoutAccountId: e.target.value || null })}>
          {/* Nothing chosen yet reads as nothing chosen, not as the first account, which was never saved. */}
          {(choices.length === 0 || settings.payoutAccountId === null) && (
            <option value="">{choices.length === 0 ? `No account holds ${currency}` : 'Choose one'}</option>
          )}
          {choices.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectRow>,
      );
    }
    rows.push(
      <SwitchRow key="keep" label="Keep the rate when it rolls over" checked={settings.keepRate} onChange={(keepRate) => save({ keepRate })} />,
    );
  }

  /*
   * The deposit's own facts close the group whatever the switch says; the choice's settings only exist once it is
   * on. Interest paid is the one of the two the choice can answer by itself: with everything rolling over there is
   * no monthly payout to choose, so the row states the answer instead of offering one that would contradict it.
   */
  rows.push(
    settings.atMaturity === 'principal_interest' ? (
      <ReadOnlyRow key="paid" label="Interest paid" value="At maturity" />
    ) : (
      <SelectRow key="paid" label="Interest paid" value={settings.interestPaid} onChange={(e) => save({ interestPaid: e.target.value as DepositAutomationRow['interestPaid'] })}>
        <option value="monthly">Monthly</option>
        <option value="at_maturity">At maturity</option>
      </SelectRow>
    ),
  );

  // The tax the bank withholds is the deposit's own, not a part of what its maturity does: its own group, under the
  // switch that is the only thing that can make it matter (interest is posted by the automation, and nothing else).
  const taxRows = settings.enabled
    ? [
        <SwitchRow
          key="exempt"
          label="Tax-free deposit"
          checked={settings.taxExempt}
          hint="Only if the rules exempt this deposit on its own. Splitting a larger sum into smaller deposits doesn't make them tax-free."
          onChange={(taxExempt) => save({ taxExempt })}
        />,
        ...(settings.taxExempt
          ? []
          : [<TextRow key="tax" label="Tax withheld %" value={taxText} inputMode="decimal" onChange={(e) => setTaxText(e.target.value)} onBlur={commitTax} />]),
      ]
    : null;

  return (
    <div data-testid="maturity-settings" aria-busy={saving > 0}>
      <InsetGroup>{rows}</InsetGroup>
      {taxRows && <InsetGroup header="Tax">{taxRows}</InsetGroup>}
      <ErrorBox error={error} />
    </div>
  );
}
