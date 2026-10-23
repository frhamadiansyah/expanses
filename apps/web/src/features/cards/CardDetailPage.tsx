import { getRouteApi } from '@tanstack/react-router';
import { Settings } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { useBalances } from '../../lib/queries';
import { InsetGroup, InsetRow, LargeTitle, useWalletSlot } from '../../ui/native';
import { InstallmentList } from '../loans/InstallmentList';
import { creditMinor, owedMinor } from '../networth/debt-rows';
import { useCardPage } from './card-page';
import { CardHero } from './CardHero';

// The card page hangs off Wallet's layout, which has an id and no path, so its route is named through it.
const route = getRouteApi('/_wallet/cards/$cardId');

/** The ground a native screen is laid on, and the column a desktop reads it in. */
function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-5xl">{children}</div>
    </div>
  );
}

/** What each setup step asks for, under its number. */
const STEP_ASKS = { 1: 'Billing date and due date', 2: 'Card product, from the catalogue or by hand', 3: 'Earning rules' } as const;

/**
 * A card's page: its summary. What it owes and what is left of the limit, Pay · Spend · Points · Statement, this
 * statement's points, the instalment plans and the latest purchases. The four tabs it had are pages of their own:
 * the statement (Statement, See all), this statement's points (its row), the programme's balance (Points) and the
 * card's settings (⚙), where a card still being set up does its next step.
 */
export function CardDetailPage() {
  const { cardId } = route.useParams();
  const { page, gate } = useCardPage(cardId);
  const balances = useBalances();
  // Opened from the Wallet stack, the raised card is this page's header and the stack's screen is its ground.
  const slot = useWalletSlot();
  const Ground = slot ? Fragment : Screen;
  if (!page) {
    return (
      <>
        {slot && <div aria-hidden style={{ height: slot.height }} className="mb-5" />}
        {gate}
      </>
    );
  }
  const { card, cp, all, plastic, issuer, isDebit, step, today, ledger, currency } = page;
  // The Debts page's figure for this card, read by the same function, so the two screens always agree.
  const owed = isDebit ? 0 : owedMinor(balances.data ?? {}, card.id);
  // Paid past what it owed: the bank holds the rest. Unpaid stays at nothing, as the Debts page says.
  const credit = isDebit ? 0 : creditMinor(balances.data ?? {}, card.id);
  const setup =
    step === null ? undefined : (
      <InsetGroup>
        <InsetRow testId="card-setup" title="Finish setting up" subtitle={`Step ${step} of 3 · ${STEP_ASKS[step]}`} to="/cards/$cardId/settings" params={{ cardId: card.id }} />
      </InsetGroup>
    );

  return (
    <Ground>
      {/* Opened from the stack, the wallet's own bar carries ✕ and ⚙; on its own the page has a title of its own. */}
      {!slot && (
        <LargeTitle
          title={card.name}
          back="Wallet"
          backTo="/wallet"
          oneLine
          actions={[{ key: 'settings', label: 'Settings', glyph: <Settings size={20} aria-hidden />, to: '/cards/$cardId/settings', params: { cardId: card.id } }]}
        />
      )}
      <CardHero
        cp={cp}
        accounts={all}
        plastic={plastic}
        issuer={issuer}
        owedMinor={owed}
        creditMinor={credit}
        debit={isDebit}
        pointsBalance={ledger.data ? { total: ledger.data.balance.total, posted: ledger.data.balance.postedTotal, estimated: ledger.data.balance.projectedTotal } : null}
        today={today}
        setup={setup}
        instalments={<InstallmentList cardAccountId={card.id} currency={currency} />}
        lines={[...(cp.current?.lines ?? []), ...(cp.previous?.lines ?? [])]}
      />
    </Ground>
  );
}
