import { type AssetKind, averagePriceMicro, formatMinor, formatPriceMicro, formatUnits, isoDate, lastNMonths, monthOf, presetFor } from '@expanses/core';
import { archiveAccount } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox, Money } from '../../ui';
import { approxLine, type CornerAction, Hero, InsetGroup, InsetRow, LargeTitle, Panel, rateLine, SCREEN } from '../../ui/native';
import { useHeldRates, useOpenings } from '../accounts/queries';
import { useGoalLinks, useGoals } from '../goals/queries';
import { useLoans } from '../loans/queries';
import { useHoldingLinks, useSecurities } from '../investments/queries';
import { DepositProposalCard } from './DepositProposalCard';
import { DepositTermsCard } from './DepositTermsCard';
import { depositHeroLine } from './deposit-terms';
import { MaturitySettings } from './MaturitySettings';
import { METHOD_LABELS, UNIT_LABELS } from './labels';
import { PriceForm } from './PriceForm';
import { StockAndBroker } from './StockAndBroker';
import { RecordedByHand } from './RecordedByHand';
import { SetAsidePanel } from './SetAsidePanel';
import { useAssetProfile, useAssetValues, useDepositAutomation, useDepositTerms, useMonthEndValues, usePositions, usePrices, useTrades, useValuations } from './queries';
import { ValuationForm } from './ValuationForm';
import { ValueChart } from './ValueChart';

const MONTH_LABEL = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });

/** The kinds a ticker prices and a broker keeps — the Stock and broker group is theirs alone. */
const BROKER_KINDS: readonly AssetKind[] = ['stock', 'fund', 'bond'];

export function AssetDetailPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { accountId?: string };
  const accountId = params.accountId ?? '';
  const months = lastNMonths(monthOf(isoDate()), 12);

  const values = useAssetValues();
  const profile = useAssetProfile(accountId);
  const positions = usePositions();
  const prices = usePrices(accountId);
  const valuations = useValuations(accountId);
  const trades = useTrades(accountId);
  const history = useMonthEndValues(accountId, months);
  const goalLinks = useGoalLinks();
  const goals = useGoals();
  const loans = useLoans();
  const balances = useBalances();
  const accounts = useAccounts();
  // Declared with the page's other queries, before any early return: a hook after one breaks the rules of hooks.
  const links = useHoldingLinks();
  const securities = useSecurities();
  const [error, setError] = useState<unknown>(null);

  const value = values.data?.find((row) => row.accountId === accountId);
  const linkedSecurityId = (links.data ?? []).find((l) => l.accountId === accountId)?.securityId ?? null;
  const linkedToSecurity = Boolean(linkedSecurityId);
  const linkedSecurity = (securities.data ?? []).find((s) => s.id === linkedSecurityId);
  const account = (accounts.data ?? []).find((row) => row.id === accountId);
  // A pocket goes back to its account's page; any money account in a foreign currency shows ≈ and its opening rate.
  const parent = account?.parentId ? (accounts.data ?? []).find((row) => row.id === account.parentId) : undefined;
  const foreignMoney = value?.mode === 'derived' && value.currency !== ws.baseCurrency;
  const held = useHeldRates(foreignMoney && value ? [value.currency] : []);
  const openings = useOpenings(foreignMoney ? [accountId] : []);
  const heldRate = value ? held.data?.rates[value.currency] : undefined;
  const opened = openings.data?.[accountId];
  const position = positions.data?.[accountId];
  const preset = profile.data ? presetFor(profile.data.assetKind) : undefined;
  const unitLabel = profile.data?.unitKind ? UNIT_LABELS[profile.data.unitKind] : '';
  const average = position ? averagePriceMicro(position) : null;
  const gain = value ? value.valueMinor - value.costMinor : 0;
  const canArchive = value ? value.valueMinor === 0 && (position?.unitsMicro ?? 0) === 0 : false;
  const forGoals = (goalLinks.data ?? []).filter((link) => link.accountId === accountId && link.kind === 'tagged');
  // The deposit's own facts, for the line under its figure — and the term its maturity settings hold.
  const deposits = useDepositTerms();
  const deposit = (deposits.data ?? []).find((row) => row.accountId === accountId);
  const automation = useDepositAutomation(accountId);
  // The loan that bought this, when one did: its balance against the value is the equity.
  const boughtWith = (loans.data ?? []).find((loan) => loan.assetAccountId === accountId && loan.status === 'open');

  async function archive() {
    setError(null);
    try {
      await archiveAccount(database, ws, accountId);
      await invalidate();
      await navigate({ to: '/net-worth/assets' });
    } catch (e) {
      setError(e);
    }
  }

  // The gear is the page's own door to its settings: an asset's group, its tax treatment and its code.
  const actions: CornerAction[] = value
    ? [{ key: 'settings', label: 'Settings', glyph: <Settings size={22} aria-hidden />, to: '/net-worth/assets/$accountId/settings', params: { accountId } }]
    : [];

  return (
    <div className={SCREEN}>
      <LargeTitle
        title={value?.name ?? 'Asset'}
        back={parent?.name ?? 'All assets'}
        backTo={parent ? '/accounts/$accountId' : '/net-worth/assets'}
        backParams={parent ? { accountId: parent.id } : undefined}
        actions={actions}
      />
      <ErrorBox error={values.error ?? profile.error ?? error} />
      {!value && !values.isPending && <Empty>That asset is not in this workspace.</Empty>}

      {value && (
        <>
          <Hero
            minor={value.valueMinor}
            currency={value.currency}
            caption={
              <>
                {/* A deposit is read as what it pays and when it comes back, first — as its page says it. */}
                {deposit && <span className="block">{depositHeroLine(deposit, automation.data?.termMonths ?? 1)}</span>}
                Cost {formatMinor(value.costMinor, value.currency)}
                {value.costMinor !== 0 && ` · ${formatMinor(gain, value.currency)} since you bought it`}
                <span className="mt-[2px] block">
                  {foreignMoney && (
                    <span className="block">
                      {approxLine(value.valueMinor, value.currency, ws.baseCurrency, held.data?.rates ?? {})}
                      {heldRate !== undefined && ` · at ${rateLine(heldRate, value.currency, ws.baseCurrency)}`}
                      {heldRate !== undefined && held.data?.stale.includes(value.currency) && ' (last known)'}
                    </span>
                  )}
                  {foreignMoney && opened && <span className="block">Opened at {rateLine(opened.fxRateToBase, value.currency, ws.baseCurrency)}</span>}
                  {METHOD_LABELS[value.mode]}
                  {position && position.unitsMicro > 0 && (
                    <>
                      {` · ${formatUnits(position.unitsMicro)} ${unitLabel}`}
                      {average !== null && ` · average cost ${formatPriceMicro(average, value.currency)}`}
                    </>
                  )}
                  {value.asOf && ` · price from ${value.asOf}`}
                  {value.source === 'cost' && ' · no price yet, showing what you paid'}
                </span>
              </>
            }
          />

          {/* A due event of an automated deposit: directly under the hero, above every other group (spec §6.1). */}
          {account?.subtype === 'time_deposit' && (
            <DepositProposalCard accountId={accountId} onClosed={(archived) => archived && void navigate({ to: '/net-worth/assets' })} />
          )}
          {/* B3: what is promised out of this account and what is free, right under the bank's figure. */}
          <SetAsidePanel accountId={accountId} />
          {account?.subtype === 'time_deposit' && <MaturitySettings accountId={accountId} currency={value.currency} />}

          {value.mode === 'market' && (
            <PriceForm
              accountId={accountId}
              currency={value.currency}
              priceLabel={preset?.priceLabel ?? 'Price per unit'}
              priceMicro={prices.data?.[0]?.priceMicro ?? null}
              unitsMicro={position?.unitsMicro ?? 0}
              unitLabel={unitLabel}
              note={linkedSecurity ? `This price is ${linkedSecurity.ticker ?? linkedSecurity.name}'s, and values every broker that holds it.` : undefined}
            />
          )}
          {value.mode === 'snapshot' && <ValuationForm accountId={accountId} currency={value.currency} />}
          {value.mode === 'derived' && (
            <InsetGroup>
              <InsetRow title="See them" subtitle="This balance follows your transactions." to="/transactions" search={{ account: accountId }} />
            </InsetGroup>
          )}
        </>
      )}

      {value && forGoals.length > 0 && (
        <InsetGroup header="For goals">
          {forGoals.map((link) => (
            <InsetRow
              key={link.goalId}
              title={(goals.data ?? []).find((goal) => goal.id === link.goalId)?.name ?? 'A goal'}
              subtitle={link.unitsMicro === null ? undefined : `${formatUnits(link.unitsMicro)} ${unitLabel}`}
              value={<Money minor={link.valueMinor} currency={value.currency} />}
              valueTone="ink"
              chevron={false}
            />
          ))}
          <InsetRow title="Change on Buy & sell" to="/net-worth/trades" />
        </InsetGroup>
      )}

      {value && history.data && history.data.some((point) => point !== 0) && (
        <Panel header="Last 12 months">
          <ValueChart values={history.data} labels={months.map(MONTH_LABEL)} currency={value.currency} />
        </Panel>
      )}

      {/*
       * §7.6's group, for the kinds that are a ticker and a broker. Gold and jewellery are not among them: they
       * sit in a safe or at home, and their price is a buyback price per gram, not a ticker's. A holding already
       * linked keeps the group whatever its kind, so the link can still be read and changed.
       */}
      {value?.mode === 'market' && preset && (BROKER_KINDS.includes(preset.kind) || linkedToSecurity) && (
        <StockAndBroker accountId={accountId} />
      )}

      {value?.mode === 'market' && (trades.data?.length ?? 0) > 0 && (
        <InsetGroup header="Buys, sells and income">
          {[...(trades.data ?? [])].reverse().map((trade) => (
            <InsetRow
              key={trade.id}
              title={`${trade.kind === 'buy' ? 'Bought' : trade.kind === 'sell' ? 'Sold' : trade.kind === 'income' ? 'Income' : 'Units changed'}${
                trade.kind !== 'income' ? ` ${formatUnits(trade.unitsMicro)} ${unitLabel}` : ''
              }`}
              subtitle={trade.occurredOn}
              value={<Money minor={trade.grossMinor} currency={value.currency} />}
              valueTone="ink"
              chevron={false}
            />
          ))}
        </InsetGroup>
      )}

      {value?.mode === 'snapshot' && (valuations.data?.length ?? 0) > 0 && (
        <InsetGroup header="Value history">
          {(valuations.data ?? []).map((row) => (
            <InsetRow
              key={row.id}
              title={`${row.basis}${row.note ? ` · ${row.note}` : ''}`}
              subtitle={row.asOf}
              value={<Money minor={row.valueMinor} currency={value.currency} />}
              valueTone="ink"
              chevron={false}
            />
          ))}
        </InsetGroup>
      )}

      {value && boughtWith && (
        <InsetGroup
          header="What of it is yours"
          trailing={<Money minor={value.valueMinor - Math.abs(balances.data?.[boughtWith.accountId] ?? 0)} currency={value.currency} />}
          footer={`Worth ${formatMinor(value.valueMinor, value.currency)}, still owed ${formatMinor(
            Math.abs(balances.data?.[boughtWith.accountId] ?? 0),
            value.currency,
          )} to ${boughtWith.lenderName}.`}
        >
          <InsetRow title="See the loan" to="/net-worth/loans/$accountId" params={{ accountId: boughtWith.accountId }} />
        </InsetGroup>
      )}

      {value && <DepositTermsCard accountId={accountId} />}
      {value && account?.subtype === 'time_deposit' && <RecordedByHand accountId={accountId} currency={value.currency} />}

      {value && (
        /* Its own group, as the kit asks of anything destructive: the air around it is the only undo a finger has. */
        <InsetGroup
          footer={canArchive ? 'Nothing left here. Archiving hides it from the list and keeps its history.' : 'Archiving is available once nothing is left in this asset.'}
        >
          <InsetRow destructive title="Archive" onClick={() => canArchive && void archive()} className={canArchive ? undefined : 'opacity-40'} />
        </InsetGroup>
      )}
    </div>
  );
}
