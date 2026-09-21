import { isoDate, needsPayout, TERM_MONTHS, type TermMonths } from '@expanses/core';
import { type DepositAutomationRow, saveDepositAutomation } from '@expanses/db';
import { Check } from 'lucide-react';
import { useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { rateInputText } from './deposit-terms';
import { MATURITY_CHOICES, payoutChoices, taxBpsFrom, termLabel } from './maturity-settings';
import { useDepositAutomation, useDepositTerms } from './queries';

/**
 * S2: the switch and its settings, inline on the deposit's page. Off is one row and changes nothing anywhere.
 * Mounted once the saved settings are in, so the local copy starts from them.
 */
export function MaturitySettings({ accountId, currency }: { accountId: string; currency: string }) {
  const automation = useDepositAutomation(accountId);
  const terms = useDepositTerms();
  if (!automation.data || !(terms.data ?? []).some((row) => row.accountId === accountId)) return null;
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
  const queue = useRef(Promise.resolve());
  // The latest settings, including a change made before React re-rendered: two changes in one tick both survive.
  const latest = useRef(saved);

  const choices = payoutChoices(accounts.data ?? [], currency, settings.accountId);
  const payoutName = choices.find((account) => account.id === settings.payoutAccountId)?.name ?? null;

  function save(change: Partial<DepositAutomationRow>) {
    const next = { ...latest.current, ...change };
    latest.current = next;
    setSettings(next);
    setError(null);
    queue.current = queue.current.then(async () => {
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
        await invalidate();
      } catch (e) {
        setError(e);
      }
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
    <>
      <InsetGroup header="At maturity">{rows}</InsetGroup>
      <ErrorBox error={error} />
    </>
  );
}
