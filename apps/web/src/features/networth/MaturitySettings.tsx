import { isoDate, needsPayout, TERM_MONTHS, type TermMonths } from '@expanses/core';
import { type DepositAutomationRow, saveDepositAutomation } from '@expanses/db';
import { Check } from 'lucide-react';
import { useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { rateInputText } from './deposit-terms';
import { MATURITY_CHOICES, payoutChoices, saveQueue, taxBpsFrom, termLabel } from './maturity-settings';
import { useDepositAutomation } from './queries';

/**
 * S1: what happens at maturity is one row on the deposit, reading off or the chosen answer; tapping it opens the
 * sheet that holds the switch and the choices — where this used to lay them all out on the page for a decision
 * made once a year. Off is one row and changes nothing anywhere.
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
  const [open, setOpen] = useState(false);
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
          termMonths: next.termMonths,
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
      label="Automate"
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
          onClick={() => save({ atMaturity: choice.id })}
        />
      )),
      <SelectRow key="paid" label="Interest paid" value={settings.interestPaid} onChange={(e) => save({ interestPaid: e.target.value as DepositAutomationRow['interestPaid'] })}>
        <option value="monthly">Monthly</option>
        <option value="at_maturity">At maturity</option>
      </SelectRow>,
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
      <SelectRow key="term" label="Term" value={String(settings.termMonths)} onChange={(e) => save({ termMonths: Number(e.target.value) as TermMonths })}>
        {TERM_MONTHS.map((months) => (
          <option key={months} value={months}>
            {termLabel(months)}
          </option>
        ))}
      </SelectRow>,
      <SwitchRow key="keep" label="Keep the rate when it rolls over" checked={settings.keepRate} onChange={(keepRate) => save({ keepRate })} />,
      <SwitchRow
        key="exempt"
        label="Tax-free deposit"
        checked={settings.taxExempt}
        hint="Only if the rules exempt this deposit on its own. Splitting a larger sum into smaller deposits doesn't make them tax-free."
        onChange={(taxExempt) => save({ taxExempt })}
      />,
    );
    if (!settings.taxExempt) {
      rows.push(
        <TextRow key="tax" label="Tax withheld %" value={taxText} inputMode="decimal" onChange={(e) => setTaxText(e.target.value)} onBlur={commitTax} />,
      );
    }
  }

  return (
    <div data-testid="maturity-settings" aria-busy={saving > 0}>
      {/* The row reads off or the answer; the sheet holds everything that sets it. */}
      <InsetGroup>
        <InsetRow
          testId="maturity-row"
          title="At maturity"
          value={settings.enabled ? (MATURITY_CHOICES.find((choice) => choice.id === settings.atMaturity)?.row ?? 'On') : 'Off'}
          valueTone={settings.enabled ? 'tint' : 'ink-3'}
          onClick={() => setOpen(true)}
        />
        <InsetRow testId="maturity-paid" title="Interest paid" value={settings.interestPaid === 'monthly' ? 'Monthly' : 'At maturity'} chevron={false} />
      </InsetGroup>
      {open && (
        <Sheet title="At maturity" onClose={() => setOpen(false)} grouped>
          <InsetGroup>{rows}</InsetGroup>
        </Sheet>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
