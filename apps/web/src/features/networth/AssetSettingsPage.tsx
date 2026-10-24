import { CASH_ITEMS, cashItem, isoDate, type MoneyAccountSubtype } from '@expanses/core';
import { type AccountRow, archiveAccount, changeAcquired, deleteUnusedAccount, profileDefaults, renameAccount, setAccountForSpending, taxTreatmentOf } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useAccounts } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, PushedTitle, SCREEN, SwitchRow, TextRow } from '../../ui/native';
import { keptForSpending, SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { useBack } from '../../app/BackHeader';
import { useHoldingLinks } from '../investments/queries';
import { AssetSettings } from './AssetSettings';
import { BankNumberGroup } from '../accounts/BankNumberGroup';
import { CardTierGroup } from '../accounts/CardTierGroup';
import { DebitRewardsGroup } from '../accounts/DebitRewardsGroup';
import { CouponGroup } from './CouponGroup';
import { SameFundGroup } from './SameFundGroup';
import { PricesGroup } from './PricesGroup';
import { MonthlyPlanGroup } from './MonthlyPlanGroup';
import { WalletPhoneGroup } from '../accounts/WalletPhoneGroup';
import { BrokerFeesGroup } from './BrokerFeesGroup';
import { CoretaxFieldsGroup } from './CoretaxFieldsGroup';
import { useOpenings } from '../accounts/queries';
import { spendsFrom } from '../accounts/pockets';
import { type AcquiredParts, acquiredOn, partsOf } from './acquired';
import { AcquiredRow } from './AssetRows';
import { useAcquiredDates, useAssetProfile, useAssetValues } from './queries';

/** The kinds of money account, whose own page is on `/accounts` rather than the asset list. */
const CASH_SUBTYPES = new Set<string>(CASH_ITEMS.map((item) => item.id));
/** The kas code a money account of this kind files under. */
const cashCodeFor = (subtype: string | undefined): string | null => (subtype && CASH_SUBTYPES.has(subtype) ? cashItem(subtype as MoneyAccountSubtype).code : null);

/**
 * What "For spending" means, under its switch: for an account, what off does; for a pocket, the same said of its
 * currency; and for a pocket under an account kept as savings, why its switch cannot be changed.
 */
function spendingFooter(account: Pick<AccountRow, 'currency'>, parent: Pick<AccountRow, 'name' | 'kind' | 'subtype' | 'forSpending'> | null, pocketsAllOff = false): string {
  if (pocketsAllOff) return 'Every pocket is kept as savings. On puts all of them back for spending.';
  if (parent === null) return 'Off: kept as savings. Not offered under Paid with and not counted in the spending balance; money can still be moved in and out.';
  if (!keptForSpending(parent)) return `${parent.name} is kept as savings, so all its pockets are too. Switch it on for spending in its own Settings to choose pocket by pocket.`;
  return `Off: the ${account.currency} is kept as savings. Not offered under Paid with and not counted in Wallet's balance; money can still be moved in and out.`;
}

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
  const navigate = useNavigate();
  const values = useAssetValues();
  const profile = useAssetProfile(accountId);
  const accounts = useAccounts();
  const links = useHoldingLinks();
  const acquiredDates = useAcquiredDates();
  const openings = useOpenings([accountId]);
  const [error, setError] = useState<unknown>(null);

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
  // Where it is held, when that is an account: the tax report's Nama institusi unless another name is typed.
  const link = (links.data ?? []).find((row) => row.accountId === accountId);
  const heldAt = link?.brokerAccountId ? (accounts.data ?? []).find((row) => row.id === link.brokerAccountId) : undefined;
  const heldFrom = profile.data?.assetKind === 'stock' ? 'the broker' : 'the Institution on its page';
  // Money kept for spending was a card in Wallet; anything else — savings put aside included — is listed on Assets.
  const list = () => navigate(money && account && spendsFrom(account, accounts.data ?? []) ? { to: '/wallet' } : { to: '/net-worth/assets' });

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
  // A pocket's account, whose "For spending" decides before the pocket's own does.
  const spendingParent = (account?.parentId ? (accounts.data ?? []).find((row) => row.id === account.parentId) : undefined) ?? null;
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
      <ErrorBox error={values.error ?? profile.error} />
      {!value && !money && !values.isPending && <Empty>That asset is not in this workspace.</Empty>}
      {parentMoney && (
        <InsetGroup footer="Renaming it renames its pockets.">
          <TextRow
            label="Name"
            defaultValue={account!.name}
            placeholder="Name"
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next === '' || next === account!.name) return;
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

      {/* Only once the profile is in: the rows fill themselves when they mount, and an empty code reads as "not chosen". */}
      {value && !profile.isPending && (
        <AssetSettings
          key={accountId}
          accountId={accountId}
          name={value.name}
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
          afterName={acquired ? <AcquiredRow value={acquired} onChange={saveAcquired} /> : undefined}
          // The tax report's own questions, here rather than on an Edit screen of their own (a money account's stay below).
          taxFields={
            // Only while it is reported: off, the report asks nothing of it.
            !money && profile.data?.coretaxSection
              ? (lead) => (
                  <CoretaxFieldsGroup
                    key={`fields-${accountId}`}
                    profile={profile.data!}
                    section={profile.data!.coretaxSection!}
                    fallbacks={heldAt ? { inst: { value: heldAt.name, from: heldFrom } } : undefined}
                    lead={lead}
                  />
                )
              : undefined
          }
        />
      )}

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

      {/*
       * Whether this money is for spending: on, it is a card in Wallet, offered under Paid with and counted in the
       * spending balance; off, it is kept as savings and read on Assets alone. An account has the switch, and so does
       * each of its pockets — the lira left in cash after a trip, kept while the rupiah is still spent. A pocket counts
       * only while its account does too (`keptForSpending`), so under an account kept as savings its switch is shown
       * off and cannot be changed. An account whose pockets are all switched off reads off too, as Wallet reads it
       * (`spendsFrom`); switched on, every pocket comes back. Saves as it is switched, as every row here does.
       */}
      {account && account.kind === 'asset' && SPENDABLE_SUBTYPES.includes(account.subtype) && (
        <InsetGroup footer={spendingFooter(account, spendingParent, keptForSpending(account) && !spendsFrom(account, accounts.data ?? []))}>
          <SwitchRow
            label="For spending"
            // As Wallet reads it: an account whose pockets are all switched off reads off (`spendsFrom`).
            checked={spendsFrom(account, accounts.data ?? [])}
            disabled={spendingParent !== null && !keptForSpending(spendingParent)}
            onChange={(on) =>
              void (async () => {
                setError(null);
                try {
                  await setAccountForSpending(database, ws, accountId, on);
                  await invalidate();
                } catch (err) {
                  setError(err);
                }
              })()
            }
          />
        </InsetGroup>
      )}

      {/* A broker's cash account says what the broker charges, for the Buy and Sell sheets. */}
      {account?.subtype === 'fund' && <BrokerFeesGroup accountId={accountId} />}
      {/* A digital wallet says which phone number it is tied to, by its last four digits. */}
      {account?.subtype === 'ewallet' && <WalletPhoneGroup accountId={accountId} />}
      {/* A bank account says which account number it is, by its last four digits. */}
      {(account?.subtype === 'bank' || account?.subtype === 'savings') && <BankNumberGroup accountId={accountId} />}
      {/* …and, at a bank whose debit cards come in tiers, which of them its card in Wallet is drawn as. */}
      {account && (account.subtype === 'bank' || account.subtype === 'savings') && account.parentId === null && <CardTierGroup account={account} />}
      {/* …and whether its debit card earns rewards: the way to the card's page, where they are set up and kept. */}
      {account && (account.subtype === 'bank' || account.subtype === 'savings') && account.parentId === null && <DebitRewardsGroup accountId={account.id} />}

      {/* A money account's tax fields stay here; an asset's are on its Edit screen, with its name and when it was got. */}
      {/* A money account opened before it had a profile (a broker made from Add holding) still shows its kas row: saving a
          field gives it the profile Add account would have. */}
      {money && profile.isSuccess && (profile.data?.reportable ?? true) && (
        <CoretaxFieldsGroup
          key={`fields-${accountId}`}
          profile={profile.data ?? { ...profileDefaults('cash'), coretaxSection: 'kas', coretaxCode: cashCodeFor(account?.subtype), accountId, workspaceId: ws.workspaceId, updatedAt: '' }}
          section={profile.data?.coretaxSection ?? 'kas'}
        />
      )}

      {(value || parentMoney) && (
        <>
          <InsetGroup>
            <DestructiveRow
              label="Archive"
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
