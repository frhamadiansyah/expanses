import { CASH_ITEMS, cashItem, formatMinor, groupTypedAmount, isoDate, minorToMajorString, type MoneyAccountSubtype, parseMajor } from '@expanses/core';
import { archiveAccount, changeAcquired, changeOriginalCost, deleteUnusedAccount, profileDefaults, renameAccount, taxTreatmentOf } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useAccounts, useResolveRates } from '../../lib/queries';
import { openingRateFor } from '../../lib/rates';
import { Empty, ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, PickerRow, PushedTitle, ReadOnlyRow, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { typedNameOf } from '../../lib/account-name';
import { useBack } from '../../app/BackHeader';
import { useHoldingLinks } from '../investments/queries';
import { AssetSettings } from './AssetSettings';
import { CouponGroup } from './CouponGroup';
import { SameFundGroup } from './SameFundGroup';
import { PricesGroup } from './PricesGroup';
import { MonthlyPlanGroup } from './MonthlyPlanGroup';
import { SettingsNameRow } from '../accounts/SettingsNameRow';
import { AccountSettingsBox } from '../accounts/AccountSettingsBox';
import { BrokerFeesGroup } from './BrokerFeesGroup';
import { CoretaxFieldsGroup } from './CoretaxFieldsGroup';
import { useOpenings } from '../accounts/queries';
import { spendsFrom } from '../accounts/pockets';
import { type AcquiredParts, acquiredOn, partsOf } from './acquired';
import { AcquiredRow, MoneyRow } from './AssetRows';
import { ValueSheet } from './AssetSheets';
import { SellSheet } from './SellSheet';
import { useAcquiredDates, useAssetProfile, useAssetProfiles, useAssetValues, useTrades } from './queries';
import { NEW_BROKER, NewBrokerSheet } from './NewBrokerSheet';
import { custodianLine, tickerLocked } from './share-identity';
import { useStockAndBroker } from './StockAndBroker';

/** The day an acquired date posts on, or null while it is not one yet (a year half typed). */
function tryAcquiredDay(parts: AcquiredParts): string | null {
  try {
    return acquiredOn(parts, isoDate()).on;
  } catch {
    return null;
  }
}

/** The kinds of money account, whose own page is on `/accounts` rather than the asset list. */
const CASH_SUBTYPES = new Set<string>(CASH_ITEMS.map((item) => item.id));
/** The kas code a money account of this kind files under. */
const cashCodeFor = (subtype: string | undefined): string | null => (subtype && CASH_SUBTYPES.has(subtype) ? cashItem(subtype as MoneyAccountSubtype).code : null);

export function AssetSettingsRoute() {
  const { accountId } = useParams({ from: '/net-worth/assets/$accountId/settings' });
  return <AssetSettingsPage accountId={accountId} />;
}

/**
 * An account's or an asset's settings on a page of their own: its name, what it counts as, its tax treatment and its
 * tax-report code, and — for a money account — the fields the DJP form asks of its table (an asset's are on its Edit
 * screen). They are changed once or twice a year, so they wait
 * behind the ⋯ of the page they belong to, which is where the round ‹ goes back to.
 *
 * Every row saves as it is changed, as iOS's own settings do; the page has no Save. The way out — archive, or delete
 * for a thing opened by mistake — is the last group, in ink rather than alarm, each asking first.
 */
export function AssetSettingsPage({ accountId }: { accountId: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const navigate = useNavigate();
  const values = useAssetValues();
  const profile = useAssetProfile(accountId);
  const accounts = useAccounts();
  const links = useHoldingLinks();
  const acquiredDates = useAcquiredDates();
  const openings = useOpenings([accountId]);
  const [error, setError] = useState<unknown>(null);
  const [valuing, setValuing] = useState(false);
  const [selling, setSelling] = useState(false);
  // The original cost as typed while the row is being edited; null shows what is stored.
  const [costDraft, setCostDraft] = useState<string | null>(null);
  const [newBrokerOpen, setNewBrokerOpen] = useState(false);
  const stock = useStockAndBroker(accountId, { share: true });
  const profiles = useAssetProfiles();
  const trades = useTrades(accountId);

  const value = values.data?.find((row) => row.accountId === accountId);
  const account = (accounts.data ?? []).find((row) => row.id === accountId);
  const money = account !== undefined && CASH_SUBTYPES.has(account.subtype);
  // An account with pockets holds nothing itself, so it is no asset and has no value row: its settings are its name
  // and the way out, and its pockets' are their own.
  const parentMoney = money && value === undefined && !values.isPending;
  // A holding linked to a security takes its lot size from the security, so the row is not offered.
  const linkedToSecurity = (links.data ?? []).some((link) => link.accountId === accountId && link.securityId !== null);
  const name = value?.name ?? account?.name ?? 'Asset';
  /*
   * When it was acquired, for a thing given a value (a holding is dated by its purchases): what was saved, else the day
   * it was opened, else the year on its profile. It saves when the wheel is closed, as every row here saves when left.
   */
  const stored = acquiredDates.data?.[accountId];
  const openedOn = openings.data?.[accountId]?.occurredOn;
  const acquired: AcquiredParts | null =
    value?.mode !== 'snapshot'
      ? null
      : stored
        ? partsOf(stored.on, stored.precision)
        : openedOn
          ? partsOf(openedOn, 'day')
          : { year: profile.data?.acquiredYear ? String(profile.data.acquiredYear) : '', month: '', day: '' };
  const saveAcquired = (parts: AcquiredParts) =>
    void (async () => {
      setError(null);
      try {
        await changeAcquired(database, ws, accountId, acquiredOn(parts, isoDate()), isoDate());
        await invalidate();
      } catch (e) {
        setError(e);
      }
    })();
  const storedCost = value && value.costMinor > 0 ? groupTypedAmount(minorToMajorString(value.costMinor, value.currency), value.currency) : '';
  // Saved when the row is left, as every row here is; an unchanged or unreadable figure writes nothing.
  const saveCost = () => {
    if (costDraft === null || !value) return;
    const typed = costDraft;
    setCostDraft(null);
    if (typed === storedCost) return;
    void (async () => {
      setError(null);
      try {
        const minor = typed.trim() === '' ? 0 : parseMajor(typed, value.currency);
        // A cost with no opening yet in another currency is given the rate of the day, as Add asset gives its opening.
        let rate: number | undefined;
        if (minor > 0 && value.currency !== ws.baseCurrency && openings.data?.[accountId] === undefined) {
          const day = acquired && acquired.year ? acquiredOn(acquired, isoDate()).on : isoDate();
          rate = await openingRateFor({ database, ws, currency: value.currency, openedOn: day, openingBalanceMinor: minor, typed: '', resolveRates });
        }
        await changeOriginalCost(database, ws, accountId, minor, isoDate(), rate);
        await invalidate();
      } catch (e) {
        setError(e);
      }
    })();
  };
  // Where it is held, when that is an account: the tax report's Nama institusi unless another name is typed.
  const link = (links.data ?? []).find((row) => row.accountId === accountId);
  const heldAt = link?.brokerAccountId ? (accounts.data ?? []).find((row) => row.id === link.brokerAccountId) : undefined;
  const heldFrom = profile.data?.assetKind === 'stock' ? 'the broker' : 'the Institution on its page';
  // Money kept for spending was a card in Wallet; anything else — savings put aside included — is listed on Assets.
  const list = () => navigate(money && account && spendsFrom(account, accounts.data ?? []) ? { to: '/wallet' } : { to: '/net-worth/assets' });
  // A listed share: its name is derived from its ticker and broker, and the three are set here, not on its page.
  const isShare = profile.data?.assetKind === 'stock';
  const brokerId = stock.link?.brokerAccountId ?? null;
  const rdnBank = brokerId ? (profiles.data ?? []).find((row) => row.accountId === brokerId)?.coretaxFields.inst : null;
  const locked = tickerLocked(Boolean(stock.security?.ticker), trades.isSuccess ? trades.data.length : null);
  const identity = isShare
    ? [
        <ReadOnlyRow key="name" label="Name" value={value?.name ?? account?.name} info="Set from the ticker and the broker." />,
        locked ? (
          <ReadOnlyRow key="ticker" label="Ticker" value={stock.security ? stock.security.ticker || stock.security.name : null} info="Fixed once a trade is recorded." />
        ) : (
          <PickerRow
            key="ticker"
            label="Ticker"
            value={stock.security ? stock.security.ticker || stock.security.name : null}
            placeholder="Not set"
            onOpen={() => void navigate({ to: '/net-worth/investments/new', search: { link: accountId } })}
          />
        ),
        <SelectRow
          key="broker"
          label="Broker"
          value={brokerId ?? 'none'}
          onChange={(e) => (e.target.value === NEW_BROKER ? setNewBrokerOpen(true) : void stock.keptAt(e.target.value === 'none' ? '' : e.target.value))}
        >
          {!brokerId ? <option value="none">No broker</option> : null}
          {stock.brokers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
          <option value={NEW_BROKER}>Another broker…</option>
        </SelectRow>,
        brokerId ? (
          <InsetRow key="custodian" title="Custodian" value={custodianLine(rdnBank)} to="/net-worth/assets/$accountId/settings" params={{ accountId: brokerId }} />
        ) : null,
      ]
    : undefined;

  async function leaveBy(ask: string, act: () => Promise<void>) {
    if (!window.confirm(ask)) return;
    setError(null);
    try {
      await act();
      await invalidate();
      await list();
    } catch (e) {
      setError(e);
    }
  }

  // An asset holding anything is not archived: it would leave the list with money still in it. A money account goes
  // whatever it holds (a parent with pockets is refused by the database, which says which are left), but a pocket only
  // once it is empty.
  const pocket = Boolean(account?.parentId);
  const archivable = money ? !pocket || !value || value.valueMinor === 0 : !value || (value.valueMinor === 0 && (value.unitsMicro ?? 0) === 0 && (value.mode !== 'amount' || value.costMinor === 0));
  const goBack = useBack(money ? `/accounts/${accountId}` : `/net-worth/assets/${accountId}`);
  return (
    <div className={SCREEN}>
      <PushedTitle
        title="Settings"
        back={name}
        // Every row is kept when it is left; the ✓ finishes the one being typed in and goes back, so saving is seen.
        actions={[
          {
            key: 'save',
            label: 'Save',
            glyph: <Check size={20} aria-hidden />,
            run: () => {
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              window.setTimeout(goBack, 0);
            },
          },
        ]}
        // Back to the page these settings were opened from (its ⋯); a page opened with nothing behind it falls back
        // to the account's or the asset's own page.
        onBack={goBack}
      />
      <ErrorBox error={values.error ?? profile.error ?? stock.error} />
      {!value && !money && !values.isPending && <Empty>That asset is not in this workspace.</Empty>}
      {parentMoney && (
        <InsetGroup footer="Renaming it renames its pockets.">
          <TextRow
            label="Name"
            // The name as typed: the bank shown in front of it on every other screen is not part of it.
            defaultValue={typedNameOf(account!)}
            placeholder="Name"
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next === '' || next === typedNameOf(account!)) return;
              void (async () => {
                setError(null);
                try {
                  await renameAccount(database, ws, accountId, next);
                  await invalidate();
                } catch (err) {
                  setError(err);
                }
              })();
            }}
          />
        </InsetGroup>
      )}
      {parentMoney && account && <AccountSettingsBox account={account} onError={setError} />}

      {/* Only once the profile is in: the rows fill themselves when they mount, and an empty code reads as "not chosen". */}
      {value && !profile.isPending && (
        <AssetSettings
          key={accountId}
          accountId={accountId}
          name={value.typedName}
          group={profile.data?.planGroup ?? value.planGroup}
          assetKind={profile.data?.assetKind ?? null}
          subtype={account?.subtype}
          lotSize={profile.data?.lotSize ?? null}
          // A lot is a share count: listed shares only, never a fund's units, a bond's face or gold's grams.
          showLotSize={value.mode === 'market' && profile.data?.unitKind === 'shares' && !linkedToSecurity}
          reportable={profile.data?.reportable ?? true}
          coretaxCode={profile.data?.coretaxCode ?? null}
          // As the tax report reads it: a deposit nobody set shows final, the band its interest is reported in.
          taxTreatment={taxTreatmentOf(profile.data?.taxTreatment, account?.subtype)}
          nameRow={identity ?? (account && (account.subtype === 'bank' || account.subtype === 'savings') && account.parentId === null ? <SettingsNameRow accountId={accountId} /> : undefined)}
          beforeTax={money && account ? <AccountSettingsBox account={account} onError={setError} /> : undefined}
          afterName={
            acquired
              ? [
                  <AcquiredRow key="acquired" value={acquired} onChange={saveAcquired} />,
                  <MoneyRow key="cost" label="Original cost" value={costDraft ?? storedCost} onChange={setCostDraft} onBlur={saveCost} currency={value.currency} placeholder="Amount" />,
                  // The one thing done to an estimated asset, now that its page has no button for it.
                  <PickerRow key="value" label="Value" value={formatMinor(value.valueMinor, value.currency)} onOpen={() => setValuing(true)} />,
                ]
              : undefined
          }
          // The tax report's own questions, here rather than on an Edit screen of their own (a money account's stay below).
          taxFields={
            // Only while it is reported: off, the report asks nothing of it. A money account opened before it had a
            // profile (a broker made from Add holding) still shows its kas row: saving a field gives it the profile
            // Add account would have.
            money || profile.data?.coretaxSection
              ? (lead, tail) => (
                  <CoretaxFieldsGroup
                    key={`fields-${accountId}`}
                    profile={profile.data ?? { ...profileDefaults('cash'), coretaxSection: 'kas', coretaxCode: cashCodeFor(account?.subtype), accountId, workspaceId: ws.workspaceId, updatedAt: '' }}
                    section={profile.data?.coretaxSection ?? 'kas'}
                    fallbacks={heldAt ? { inst: { value: heldAt.name, from: heldFrom } } : undefined}
                    lead={lead}
                    tail={tail}
                    hide={account?.subtype === 'bank' || account?.subtype === 'savings' ? ['acct', 'inst'] : undefined}
                  />
                )
              : undefined
          }
        />
      )}

      {newBrokerOpen && <NewBrokerSheet onSave={(name) => void stock.newBroker(name).then(() => setNewBrokerOpen(false))} onClose={() => setNewBrokerOpen(false)} />}

      {/* A bond's coupon: its rate, how often and from when it pays, and whether the app records it on the day. */}
      {/*
       * A holding priced by the unit: its price source, the way to Update prices, and a change of units with no money
       * (a split, bonus shares), each set seldom, so here rather than on its page.
       */}
      {value && (
        <PricesGroup
          accountId={accountId}
          priced={value.mode === 'market'}
          gold={profile.data?.assetKind === 'gold' && profile.data.unitKind === 'grams'}
          holding={{ name: value.name, currency: value.currency, unitKind: profile.data?.unitKind ?? null }}
        />
      )}

      {/* A regular monthly buy of it: set once, and due on Recurring when its day comes. */}
      {value && <MonthlyPlanGroup accountId={accountId} />}

      {/* The same fund at another place, tied into one row on Assets: seldom set, so here rather than on its page. */}
      {profile.data?.assetKind === 'fund' && <SameFundGroup accountId={accountId} />}

      {profile.data?.assetKind === 'bond' && <CouponGroup accountId={accountId} heldAt={profile.data.coretaxFields.inst?.trim() || null} />}

      {/* A broker's cash account says what the broker charges, for the Buy and Sell sheets. */}
      {account?.subtype === 'fund' && <BrokerFeesGroup accountId={accountId} />}
      {/* A money account's tax fields stay here; an asset's are on its Edit screen, with its name and when it was got. */}
      {/* A money account opened before it had a profile (a broker made from Add holding) still shows its kas row: saving a
          field gives it the profile Add account would have. */}
      {parentMoney && profile.isSuccess && (profile.data?.reportable ?? true) && (
        <CoretaxFieldsGroup
          key={`fields-${accountId}`}
          profile={profile.data ?? { ...profileDefaults('cash'), coretaxSection: 'kas', coretaxCode: cashCodeFor(account?.subtype), accountId, workspaceId: ws.workspaceId, updatedAt: '' }}
          section={profile.data?.coretaxSection ?? 'kas'}
        />
      )}

      {valuing && value && <ValueSheet accountId={accountId} currency={value.currency} onClose={() => setValuing(false)} />}
      {selling && value && (
        <SellSheet
          asset={{ accountId, name: value.name, currency: value.currency, costMinor: value.costMinor }}
          acquiredOn={acquired && acquired.year ? tryAcquiredDay(acquired) : null}
          onClose={() => setSelling(false)}
          // Sold, the asset has no value row any more: its page now reads Sold.
          onSold={() => void navigate({ to: '/net-worth/assets/$accountId', params: { accountId } })}
        />
      )}

      {(value || parentMoney) && (
        <>
          <InsetGroup>
            {/* Only a thing valued by an estimate is sold from here; a priced holding is sold with Trade. */}
            {value?.mode === 'snapshot' && <DestructiveRow label="Sell" calm onClick={() => setSelling(true)} />}
            <DestructiveRow
              label="Archive"
              calm
              // Not yet: grey, and a press says why, as Delete's press asks first.
              muted={!archivable}
              onClick={() =>
                archivable
                  ? void leaveBy(`Archive ${name}? It leaves the list; its history stays in reports.`, () => archiveAccount(database, ws, accountId))
                  : window.alert(`Archiving is available once nothing is left in this ${money ? 'pocket' : 'asset'}.`)
              }
            />
            <DestructiveRow
              label="Delete"
              onClick={() =>
                void leaveBy(
                  `Delete ${name}? Only for something opened by mistake: it must hold nothing but its opening entry, with no goal promising its money. Otherwise move the money out and archive it.`,
                  () => deleteUnusedAccount(database, ws, accountId),
                )
              }
            />
          </InsetGroup>
          <ErrorBox error={error} />
        </>
      )}
    </div>
  );
}
