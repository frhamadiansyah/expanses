import { pocketParentIds, SPENDABLE_SUBTYPES } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { useAccounts, useBalances } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { ApproxFigure, approxLine, Hero, InsetGroup, InsetRow, LargeTitle, rateLine, SCREEN } from '../../ui/native';
import { currencyName, parentTotal, pocketCount, pocketsOf } from './pockets';
import { useHeldRates, useOpenings } from './queries';

/** An account with pockets: what it adds up to, each pocket in its own currency, and the ways to move or add one. */
export function PocketsPage() {
  const { ws } = useApp();
  const { accountId = '' } = useParams({ strict: false }) as { accountId?: string };
  const accounts = useAccounts();
  const balances = useBalances();
  const all = accounts.data ?? [];
  const parent = all.find((a) => a.id === accountId);
  const pockets = pocketsOf(accountId, all);
  const rates = useHeldRates(pockets.map((p) => p.currency!));
  const openings = useOpenings(pockets.map((p) => p.id));
  const held = rates.data?.rates ?? {};
  const stale = new Set(rates.data?.stale ?? []);

  if (accounts.isSuccess && !parent) return <div className={SCREEN}><LargeTitle title="Account" back="Accounts" backTo="/accounts" /><Empty>That account is not in this workspace.</Empty></div>;
  if (!parent) return <div className={SCREEN}>Loading…</div>;
  // Any account id reaches this route; only one named as a parent has pockets to show, move between or add to.
  if (!pocketParentIds(all).has(parent.id)) return <NoPockets name={parent.name} />;

  const total = parentTotal(pockets, balances.data ?? {}, ws.baseCurrency, held);
  const foreign = pockets.filter((p) => p.currency !== ws.baseCurrency && held[p.currency!] !== undefined);
  const spendable = SPENDABLE_SUBTYPES.includes(parent.subtype);

  return (
    <div className={SCREEN}>
      <LargeTitle title={parent.name} back="Accounts" backTo="/accounts" />
      <ErrorBox error={accounts.error ?? balances.error ?? rates.error} />
      {total.totalMinor !== null ? (
        <Hero
          minor={total.totalMinor}
          currency={ws.baseCurrency}
          caption={
            <>
              {foreign.length > 0 && `≈ at ${foreign.map((p) => `${rateLine(held[p.currency!]!, p.currency!, ws.baseCurrency)}${stale.has(p.currency!) ? ' (last known)' : ''}`).join(' · ')}`}
              <span className="mt-[2px] block">
                {pocketCount(pockets.length)} · {spendable ? 'can be spent from' : 'cannot be spent from directly'}
              </span>
            </>
          }
        />
      ) : (
        <Empty>No {total.missing.join(', ')} rate yet, so the pockets cannot be added up. Each balance below is exact.</Empty>
      )}
      <InsetGroup header="Pockets" footer="Each pocket keeps its own balance in its own currency. The account only adds them up.">
        {pockets.map((pocket) => {
          const minor = balances.data?.[pocket.id] ?? 0;
          const beneath = approxLine(minor, pocket.currency!, ws.baseCurrency, held);
          const opened = openings.data?.[pocket.id];
          return (
            <InsetRow
              key={pocket.id}
              testId={`pocket-${pocket.currency}`}
              title={currencyName(pocket.currency!)}
              subtitle={opened ? `Opened ${opened.occurredOn}` : undefined}
              value={<ApproxFigure figure={<Money minor={minor} currency={pocket.currency!} />} beneath={beneath} />}
              valueTone="ink"
              to="/net-worth/assets/$accountId"
              params={{ accountId: pocket.id }}
            />
          );
        })}
      </InsetGroup>
      <InsetGroup>
        {pockets.length >= 2 && <InsetRow title="Move between pockets" subtitle="At the bank's rate" to="/accounts/$accountId/move" params={{ accountId }} />}
        <InsetRow title="Add a pocket" subtitle="Another currency this account holds" to="/accounts/$accountId/pocket" params={{ accountId }} />
        <InsetRow title="See their transactions" to="/transactions" search={{ account: accountId }} />
      </InsetGroup>
    </div>
  );
}

/** Reached with an account that has no pockets: say so, rather than a Rp 0 account with a form that fails on submit. */
export function NoPockets({ name }: { name: string }) {
  return (
    <div className={SCREEN}>
      <LargeTitle title={name} back="Accounts" backTo="/accounts" />
      <Empty>This account does not hold more than one currency, so it has no pockets.</Empty>
    </div>
  );
}
