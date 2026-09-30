import { isoDate, parseRate } from '@expanses/core';
import { type DepositAutomationRow, type DepositTermsRow, upsertRate, withdrawDeposit } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { checkManualRate, ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { ArrowUpFromLine, LockOpen } from 'lucide-react';
import { ActionButtons, InsetGroup, InsetRow, SelectRow, TextRow } from '../../ui/native';
import { defaultInto, landsText, MONEY_OUT_FOOTER, MONEY_OUT_TITLE, type MoneyOutMode, moneyOutDraft, moneyOutMode, readMoneyOut } from './deposit-money-out';
import { payoutChoices } from './maturity-settings';
import { useDepositAutomation, useDepositTerms } from './queries';

/**
 * The one way money leaves a deposit by hand: "Break early" before the maturity and "Withdraw" from it on. Not there
 * once the deposit is empty or closed.
 *
 * Drawn as a row under the figure, or — on the account's own page, where every money account's actions are round
 * buttons under its figure — as the one round button a deposit has (`look="action"`). The sheet and what it posts are
 * the same either way.
 */
export function DepositMoneyOut({
  accountId,
  currency,
  balanceMinor,
  onClosed,
  look = 'row',
}: {
  accountId: string;
  currency: string;
  balanceMinor: number;
  onClosed: (archived: boolean) => void;
  look?: 'row' | 'action';
}) {
  const accounts = useAccounts();
  const terms = useDepositTerms();
  const automation = useDepositAutomation(accountId);
  const [open, setOpen] = useState(false);
  const account = (accounts.data ?? []).find((row) => row.id === accountId);
  if (!account || account.archivedAt !== null || balanceMinor <= 0 || !automation.data || !terms.data) return null;
  const deposit = terms.data.find((row) => row.accountId === accountId);
  const mode = moneyOutMode(deposit?.maturesOn, isoDate());
  return (
    <>
      {look === 'action' ? (
        <ActionButtons
          actions={[
            {
              key: 'out',
              label: MONEY_OUT_TITLE[mode],
              glyph: mode === 'withdraw' ? <ArrowUpFromLine size={20} aria-hidden /> : <LockOpen size={20} aria-hidden />,
              run: () => setOpen(true),
              testId: 'deposit-money-out',
            },
          ]}
        />
      ) : (
        <InsetGroup>
          {[<InsetRow key="out" title={MONEY_OUT_TITLE[mode]} chevron={false} onClick={() => setOpen(true)} testId="deposit-money-out" />]}
        </InsetGroup>
      )}
      {open && (
        <MoneyOutSheet
          mode={mode}
          accountId={accountId}
          currency={currency}
          balanceMinor={balanceMinor}
          terms={deposit}
          settings={automation.data}
          onClose={() => setOpen(false)}
          onDone={(archived) => {
            setOpen(false);
            onClosed(archived);
          }}
        />
      )}
    </>
  );
}

function MoneyOutSheet({
  mode,
  accountId,
  currency,
  balanceMinor,
  terms,
  settings,
  onClose,
  onDone,
}: {
  mode: MoneyOutMode;
  accountId: string;
  currency: string;
  balanceMinor: number;
  terms: DepositTermsRow | undefined;
  settings: DepositAutomationRow;
  onClose: () => void;
  onDone: (archived: boolean) => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useAccounts();
  const today = isoDate();
  const choices = payoutChoices(accounts.data ?? [], currency, accountId);
  const [draft, setDraft] = useState(() =>
    moneyOutDraft({ mode, balanceMinor, currency, terms, settings, intoAccountId: defaultInto(choices, settings.payoutAccountId), today }),
  );
  const [manualRate, setManualRate] = useState('');
  const [askRate, setAskRate] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const foreign = currency !== ws.baseCurrency;
  const intoName = choices.find((account) => account.id === draft.intoAccountId)?.name;
  const set = (change: Partial<typeof draft>) => setDraft((was) => ({ ...was, ...change }));

  async function post() {
    setError(null);
    setBusy(true);
    try {
      if (!draft.intoAccountId) throw new Error('Choose the account the money lands in');
      const figures = readMoneyOut(mode, draft, currency);
      let rateToBase: number | undefined;
      if (foreign) {
        if (manualRate.trim()) {
          rateToBase = parseRate(manualRate);
          await checkManualRate(database, currency, ws.baseCurrency, draft.occurredOn, rateToBase);
          await upsertRate(database, { fromCurrency: currency, toCurrency: ws.baseCurrency, onDate: draft.occurredOn, rate: rateToBase, source: 'manual', sourceDate: draft.occurredOn });
        } else {
          rateToBase = (await resolveRates([currency], draft.occurredOn)).rates[currency];
          if (rateToBase === undefined) {
            setAskRate(true);
            throw new Error(`No ${currency}→${ws.baseCurrency} rate for ${draft.occurredOn}. Enter it below.`);
          }
        }
      }
      const result = await withdrawDeposit(database, ws, { accountId, intoAccountId: draft.intoAccountId, occurredOn: draft.occurredOn, ...figures, rateToBase });
      await invalidate();
      onDone(result.archived);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  // Rows as arrays: InsetGroup numbers its children with Children.toArray, which does not look inside a fragment.
  const where = [
    <SelectRow key="into" label="Into" value={draft.intoAccountId} onChange={(e) => set({ intoAccountId: e.target.value })}>
      {choices.length === 0 && <option value="">{`No account holds ${currency}`}</option>}
      {choices.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
    </SelectRow>,
    <TextRow key="date" label="Date" type="date" value={draft.occurredOn} max={today} onChange={(e) => set({ occurredOn: e.target.value })} />,
  ];
  if (foreign && askRate) {
    where.push(
      <TextRow
        key="fx"
        label={`Rate: ${ws.baseCurrency} per 1 ${currency}`}
        hint={ratePreview(manualRate, currency, ws.baseCurrency) ?? undefined}
        inputMode="decimal"
        value={manualRate}
        onChange={(e) => setManualRate(e.target.value)}
      />,
    );
  }
  const pays = [
    <TextRow key="principal" label="Principal" inputMode="decimal" value={draft.principal} onChange={(e) => set({ principal: e.target.value })} />,
    <TextRow key="interest" label="Interest" inputMode="decimal" value={draft.interest} onChange={(e) => set({ interest: e.target.value })} />,
    mode === 'withdraw' ? (
      <TextRow key="tax" label="Tax withheld" inputMode="decimal" value={draft.tax} onChange={(e) => set({ tax: e.target.value })} />
    ) : (
      <TextRow key="penalty" label="Penalty fee" inputMode="decimal" placeholder="0" value={draft.penalty} onChange={(e) => set({ penalty: e.target.value })} />
    ),
    <InsetRow
      key="lands"
      title={intoName ? `Lands in ${intoName}` : 'Lands'}
      value={<span className="font-semibold text-[var(--ph-ink)]">{landsText(mode, draft, currency)}</span>}
      chevron={false}
      testId="money-out-lands"
    />,
  ];

  return (
    <Sheet grouped title={MONEY_OUT_TITLE[mode]} onClose={onClose} confirm={{ label: MONEY_OUT_TITLE[mode], disabled: busy, run: () => void post() }}>
      <div className="flex flex-col gap-4">
        <InsetGroup>{where}</InsetGroup>
        <InsetGroup header="What the bank pays" footer={MONEY_OUT_FOOTER[mode]}>
          {pays}
        </InsetGroup>
        <ErrorBox error={error} />
      </div>
    </Sheet>
  );
}
