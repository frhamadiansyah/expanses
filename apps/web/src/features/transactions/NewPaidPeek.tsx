import { CASH_ITEMS, type MoneyAccountSubtype } from '@expanses/core';
import { useId, useState } from 'react';
import { canPayWith } from '../../lib/account-types';
import { cx } from '../../ui';
import { PEEK_BUTTON, SidePeek } from '../../ui/native/SidePeek';
import { type FormStep, NewCardForm } from '../ownables/AddDebtPage';
import { CashAccountForm } from '../ownables/CashAccountForm';
import { type AddPaidChoice, rowsLine } from './paste-categories';

/** The kinds of account a purchase can be paid from, as the Paid with sheet's own Add account offers them. */
const PAYING_KINDS = CASH_ITEMS.map((item) => item.id as MoneyAccountSubtype).filter((subtype) => canPayWith({ id: '', kind: 'asset', subtype }, ''));

/**
 * Cashflow's side peek for a pasted Paid with not in cicis yet (owner 2026-11-20): today's New credit card or New account
 * form — the same components the Paid with sheet embeds, saving through their own code — filled in with the pasted last
 * four digits or name. Saving hands the new account to the page (`onCreated`), which fills the waiting rows naming it.
 */
export function NewPaidPeek({ top, choice, onClose, onCreated }: { top: number; choice: AddPaidChoice; onClose: () => void; onCreated: (accountId: string) => void }) {
  const formId = useId();
  const [canSave, setCanSave] = useState(false);
  const [step, setStep] = useState<FormStep | null>(null);
  const [kind, setKind] = useState<MoneyAccountSubtype>(PAYING_KINDS.includes('bank') ? 'bank' : PAYING_KINDS[0]!);
  const card = choice.kind === 'card';
  const embedded = { formId, onCanSave: setCanSave, onStep: setStep };
  const title = step ? step.title : card ? 'New credit card' : 'New account';
  return (
    <SidePeek
      top={top}
      label={card ? 'New credit card' : 'New account'}
      testId="new-paid-peek"
      title={title}
      noun="row"
      onClose={onClose}
      back={step ? { label: 'New credit card', onBack: step.back } : undefined}
    >
      <p className="px-[14px] pb-[12px] text-[12px] text-[var(--ph-ink-3)]" data-testid="new-paid-line">
        From the pasted rows · {rowsLine(choice.rows)} {choice.rows === 1 ? 'waits' : 'wait'} for it
      </p>
      {/* The phone form's groups, edged as the peek's own boxes are, on the peek's white. */}
      <div className="px-[14px] [&_section>div:has(>*)]:border [&_section>div:has(>*)]:border-[var(--ph-hair)]">
        {card ? (
          <NewCardForm embedded={embedded} onCreated={onCreated} initial={{ last4: choice.last4 ?? undefined, name: choice.name ?? undefined }} />
        ) : (
          <CashAccountForm
            item={kind}
            kinds={{ items: PAYING_KINDS, onChange: setKind }}
            embedded={embedded}
            onCreated={onCreated}
            initial={{ name: choice.name ?? undefined, numberLast4: choice.last4 ?? undefined }}
          />
        )}
      </div>
      {!step && (
        <div className="flex justify-end gap-[8px] px-[14px] pt-[4px] pb-[16px]">
          <button type="button" onClick={onClose} className={PEEK_BUTTON}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit()}
            className={cx('rounded-[6px] bg-[var(--ph-ink)] px-3 py-[4px] text-[13px] font-medium text-[var(--ph-surface)]', 'disabled:opacity-40')}
          >
            {card ? 'Add card' : 'Add account'}
          </button>
        </div>
      )}
    </SidePeek>
  );
}
