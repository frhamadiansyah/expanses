import { isoDate } from '@expanses/core';
import { type DepositAutomationRow, saveDepositAutomation } from '@expanses/db';
import { useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { rateInputText } from './deposit-terms';
import { payoutChoices, ROLL_OVER, saveQueue, taxBpsFrom } from './maturity-settings';
import { useDepositAutomation } from './queries';

/**
 * What happens at maturity, on the deposit's own page: one picker that says it in words, and what the answer needs
 * under it. "Ask me on the day" is the automation off, one row that changes nothing anywhere.
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

  // What the one picker reads: the choice when the maturity is automated, "Ask me on the day" when it is not.
  const rollOver = settings.enabled ? settings.atMaturity : 'off';
  // Only a choice that pays something out needs somewhere to pay it: rolling everything over leaves nothing to land.
  const paysOut = settings.enabled && settings.atMaturity !== 'principal_interest';

  // Rows as an array: InsetGroup numbers its children with Children.toArray, which does not look inside a fragment.
  const rows = [
    <SelectRow
      key="roll"
      label="Roll over"
      value={rollOver}
      info="On the day it matures the choice is proposed; nothing posts until you confirm. Ask me on the day proposes nothing."
      onChange={(e) => {
        const picked = e.target.value as DepositAutomationRow['atMaturity'] | 'off';
        if (picked === 'off') {
          save({ enabled: false });
          return;
        }
        save({
          enabled: true,
          atMaturity: picked,
          // Everything rolling over leaves nothing to pay out during the term: the interest answer is pinned by it.
          ...(picked === 'principal_interest' ? { interestPaid: 'at_maturity' as const } : {}),
          payoutAccountId: latest.current.payoutAccountId ?? choices[0]?.id ?? null,
        });
      }}
    >
      {ROLL_OVER.map((choice) => (
        <option key={choice.id} value={choice.id}>
          {choice.title}
        </option>
      ))}
    </SelectRow>,
  ];
  if (paysOut) {
    rows.push(
      <SelectRow key="payout" label="Pay out into" value={settings.payoutAccountId ?? ''} onChange={(e) => save({ payoutAccountId: e.target.value || null })}>
        {/* Nothing chosen yet reads as nothing chosen, not as the first account, which was never saved. */}
        {(choices.length === 0 || settings.payoutAccountId === null) && <option value="">{choices.length === 0 ? `No account holds ${currency}` : 'Choose one'}</option>}
        {choices.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </SelectRow>,
    );
  }
  if (settings.enabled) {
    rows.push(
      <SelectRow
        key="paid"
        label="Interest paid"
        value={settings.interestPaid}
        onChange={(e) => save({ interestPaid: e.target.value as DepositAutomationRow['interestPaid'] })}
      >
        {/* Frozen, not hidden: with everything rolling over there is nothing to pay out during the term. */}
        <option value="monthly" disabled={settings.atMaturity === 'principal_interest'}>
          Monthly
        </option>
        <option value="at_maturity">At maturity</option>
      </SelectRow>,
    );
    // Nothing rolls over on a close, so there is no rate to carry: the question stands only for the two roll-overs.
    if (settings.atMaturity !== 'close') {
      rows.push(
        <SwitchRow key="keep" label="Keep the rate when it rolls over" checked={settings.keepRate} onChange={(keepRate) => save({ keepRate })} />,
      );
    }
  }

  // The tax the bank withholds is the deposit's own, not a part of what its maturity does: its own group, under the
  // switch that is the only thing that can make it matter (interest is posted by the automation, and nothing else).
  const taxRows = settings.enabled
    ? [
        <SwitchRow
          key="exempt"
          label="Tax-free deposit"
          checked={settings.taxExempt}
          info="Only if the rules exempt this deposit on its own. Splitting a larger sum into smaller deposits doesn't make them tax-free."
          onChange={(taxExempt) => save({ taxExempt })}
        />,
        ...(settings.taxExempt
          ? []
          : [<TextRow key="tax" label="Tax withheld %" value={taxText} inputMode="decimal" onChange={(e) => setTaxText(e.target.value)} onBlur={commitTax} />]),
      ]
    : null;

  /*
   * The decision, and only the decision, said in words: what happens at maturity — or "Ask me on the day", which is
   * the automation off — then one row per question that answer raises: where the money is paid out, how the interest
   * is paid during the term, and whether the rate carries on.
   * The deposit's own facts (its rate, its date, its term) live on the Deposit terms card, and what the bank
   * withholds under Tax: a row belongs to the question it answers, and none of these three answer each other's.
   */
  return (
    <div data-testid="maturity-settings" aria-busy={saving > 0}>
      <InsetGroup header="At maturity">{rows}</InsetGroup>
      {taxRows && <InsetGroup header="Tax">{taxRows}</InsetGroup>}
      <ErrorBox error={error} />
    </div>
  );
}
