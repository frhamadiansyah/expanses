import { isoDate } from '@expanses/core';
import type { AccountRow, CardRow } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import type { LinkProps } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Empty } from '../../ui';
import { type CornerAction, PushedTitle, SCREEN, WideColumn } from '../../ui/native';
import { useCardIdentities, useCards } from './card-queries';
import { purchasesOf } from './hint-text';
import type { StatementPoints } from './StatementPanel';
import { useCardLedger } from './useCardLedger';
import { type CardPoints, loadCardPoints } from './useCardPoints';

/**
 * What every page of a card shares: the card's summary, and the pages its four tabs became — the statement, this
 * statement's points, and the settings with the pages under them. Each reads the card the same way, from the same
 * cached query, so going between them never loads the card twice.
 */

/** Runs a write, then refreshes every query; the error stays on the page that ran it. */
export function useCardAction() {
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await invalidate();
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };
  return { error, run };
}

export type Run = (fn: () => Promise<unknown>) => Promise<boolean>;

/**
 * Where a card's setup stands. The statement day defines cycles, a program holds rules, and rules produce points, so
 * the three are asked for in that order. A debit card has no statement day to ask for, so its setup starts at the
 * program. Null once all three are in.
 */
export function setupStepOf(cp: CardPoints, isDebit: boolean): 1 | 2 | 3 | null {
  return !isDebit && !cp.terms ? 1 : !cp.program ? 2 : cp.rules.length === 0 ? 3 : null;
}

export interface CardPage {
  card: AccountRow;
  all: AccountRow[];
  cp: CardPoints;
  plastic: CardRow[];
  issuer: string | null;
  today: string;
  isDebit: boolean;
  currency: string;
  step: 1 | 2 | 3 | null;
  ledger: ReturnType<typeof useCardLedger>;
}

/** The card behind `cardId`, worked out, or what to show while it is not: a card not found, or still loading. */
export function useCardPage(cardId: string): { page: CardPage | null; gate: ReactNode } {
  const { database, ws } = useApp();
  const accounts = useAccounts();
  const all = accounts.data ?? [];
  const card = all.find((a) => a.id === cardId);
  const plastic = useCards(card?.id).data ?? [];
  const identities = useCardIdentities().data ?? {};
  const today = isoDate();
  const data = useQuery({
    queryKey: ['card-points-detail', ws.workspaceId, today, cardId],
    enabled: !!card,
    queryFn: () => loadCardPoints(database, ws, card!, all, today),
  });
  // The ledger fills the cycles the pages show, then reports the balance.
  const ledger = useCardLedger(data.data?.program?.id, [data.data?.current?.cycle ?? null, data.data?.previous?.cycle ?? null], today);
  if (accounts.isSuccess && !card) return { page: null, gate: <Empty>Card not found.</Empty> };
  if (!card || !data.data) return { page: null, gate: <p className="text-sm text-slate-500">Loading…</p> };
  const cp = data.data;
  const isDebit = card.subtype !== 'credit_card';
  return {
    page: { card, all, cp, plastic, issuer: identities[card.id]?.issuer ?? null, today, isDebit, currency: card.currency!, step: setupStepOf(cp, isDebit), ledger },
    gate: null,
  };
}

/** Points for each purchase in the two cycles the card has worked out, shown beside the statement's own lines. */
export function statementPointsOf(cp: CardPoints): Record<string, StatementPoints> {
  const points: Record<string, StatementPoints> = {};
  // What the bank credited for a purchase stands in for the estimate, as it does in the card's running total.
  const credited = new Map(cp.transactionActuals.map((actual) => [actual.transactionId, actual.actualPoints]));
  for (const result of [cp.previous, cp.current]) {
    if (!result) continue;
    const approximate = new Set(result.earn.approximateTransactionIds);
    for (const purchase of purchasesOf(result.lines)) {
      // Only an MCC the owner set is worth printing on the statement; a guessed one is checked on the points page.
      const known = purchase.mccSource === 'typed' || purchase.mccSource === 'memory';
      points[purchase.transactionId] = {
        points: credited.get(purchase.transactionId) ?? result.earn.pointsByTransaction[purchase.transactionId] ?? 0,
        approximate: !credited.has(purchase.transactionId) && approximate.has(purchase.transactionId),
        mcc: purchase.cardFee || !known ? null : purchase.mcc,
        cardFee: purchase.cardFee,
      };
    }
  }
  return points;
}

/**
 * A page pushed from a card: its name, ‹ back to where it was opened from — the card, or the page above it — and the
 * groups in one column that takes the page's width on a desktop, as the card's tabs did.
 */
export function CardScreen({
  title,
  back,
  fallback,
  backTo,
  actions,
  field,
  children,
}: {
  title: string;
  /** What the way back is called: the card's name, or the page it was opened from. */
  back: string;
  /** Where ‹ goes when the page was opened with nothing behind it: a deep link, a reload. */
  fallback: LinkProps['to'];
  /**
   * An explicit target for ‹ with the card's id, for a page other pages link onward from (the Statement and its check),
   * where history would loop. It takes this page's place in the history, so the card it lands on is the card's own
   * visit and the card's ✕ still goes straight back to what opened the card (owner, 25 Nov 2026).
   */
  backTo?: { to: LinkProps['to']; cardId: string };
  actions?: CornerAction[];
  /** A search field that takes the whole bar while it is open, ‹ and name with it. */
  field?: ReactNode;
  children: ReactNode;
}) {
  const goBack = useBack(fallback);
  return (
    <div className={SCREEN}>
      <div className="mx-auto max-w-5xl">
        <PushedTitle
          title={title}
          back={back}
          onBack={goBack}
          backTo={backTo?.to}
          backParams={backTo ? { cardId: backTo.cardId } : undefined}
          backReplace={backTo !== undefined}
          actions={actions} field={field} />
        <WideColumn>{children}</WideColumn>
      </div>
    </div>
  );
}
