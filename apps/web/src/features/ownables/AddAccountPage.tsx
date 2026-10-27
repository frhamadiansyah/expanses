import { cashItem, CASH_ITEMS, type MoneyAccountSubtype } from '@expanses/core';
import { useState } from 'react';
import { PushedTitle, SCREEN, SelectRow } from '../../ui/native';
import { NewCardForm } from './AddDebtPage';
import { CARD_KIND, CARD_KIND_LABEL, CashAccountForm } from './CashAccountForm';
import { handOverRows } from './catalogue-view';
import { OwnablePicker } from './OwnablePicker';

/**
 * Adding an account, one family deep: only money belongs on the Accounts page, so there is no family level to
 * climb — the seven kinds of money account are the list.
 *
 * The two rows at the foot are the whole reason someone does not get stuck here: most people's first instinct
 * is that a house or a credit card is "an account", and the screen says plainly where each one goes instead.
 */
export function AddAccountPage() {
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <OwnablePicker
      flow="account"
      title="New account"
      searchPlaceholder="Search"
      chosen={chosen}
      onChoose={setChosen}
      handOver={handOverRows('account')}
    >
      {chosen && <CashAccountForm key={chosen} item={chosen as MoneyAccountSubtype} />}
    </OwnablePicker>
  );
}

/** Wallet's list leaves out the kinds that are not spent from: a fund account, a time deposit and other cash equivalents are added from Assets. */
const WALLET_LEFT_OUT = new Set<string>(['fund', 'time_deposit', 'other_cash']);
const KINDS = CASH_ITEMS.filter((item) => !WALLET_LEFT_OUT.has(item.id)).map((item) => item.id as MoneyAccountSubtype);

/**
 * A money account added straight from Wallet's +, with no list of kinds to climb first: the form opens as a current
 * account, the commonest, and its Type row changes the kind, keeping whatever was typed. Credit card is the row's
 * last kind: it swaps the form below for the card form, which carries the same Type row at its head.
 */
export function AddMoneyAccountPage() {
  const [item, setItem] = useState<MoneyAccountSubtype>('bank');
  const [card, setCard] = useState(false);
  const pick = (value: MoneyAccountSubtype) => {
    setItem(value);
    setCard(false);
  };
  return (
    <div className={SCREEN}>
      <PushedTitle title="New account" back="Wallet" backTo="/wallet" />
      {card ? (
        <NewCardForm
          lead={
            <SelectRow label="Type" value={CARD_KIND} onChange={(e) => pick(e.target.value as MoneyAccountSubtype)}>
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {cashItem(kind).label}
                </option>
              ))}
              <option value={CARD_KIND}>{CARD_KIND_LABEL}</option>
            </SelectRow>
          }
        />
      ) : (
        <CashAccountForm item={item} kinds={{ items: KINDS, onChange: pick, card: () => setCard(true) }} />
      )}
    </div>
  );
}
