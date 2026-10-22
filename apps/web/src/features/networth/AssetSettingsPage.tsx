import { CASH_ITEMS, cashItem, isoDate, type MoneyAccountSubtype } from '@expanses/core';
import { archiveAccount, changeAcquired, deleteUnusedAccount, profileDefaults, taxTreatmentOf } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useAccounts } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { useBack } from '../../app/BackHeader';
import { useHoldingLinks } from '../investments/queries';
import { AssetSettings } from './AssetSettings';
import { BankNumberGroup } from '../accounts/BankNumberGroup';
import { CouponGroup } from './CouponGroup';
import { WalletPhoneGroup } from '../accounts/WalletPhoneGroup';
import { BrokerFeesGroup } from './BrokerFeesGroup';
import { CoretaxFieldsGroup } from './CoretaxFieldsGroup';
import { useOpenings } from '../accounts/queries';
import { type AcquiredParts, acquiredOn, partsOf } from './acquired';
import { AcquiredRow } from './AssetRows';
import { useAcquiredDates, useAssetProfile, useAssetValues } from './queries';

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
  const heldFrom = profile.data?.assetKind === 'stock' ? 'the broker' : 'Held at';
  const list = () => navigate(money ? { to: '/accounts' } : { to: '/net-worth/assets' });

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

  // An asset holding anything is not archived: it would leave the list with money still in it. A money account's own
  // page has its rules for that, so only an asset's are said here.
  const archivable = money || !value || (value.valueMinor === 0 && (value.unitsMicro ?? 0) === 0 && (value.mode !== 'amount' || value.costMinor === 0));
  const goBack = useBack(money ? `/accounts/${accountId}` : `/net-worth/assets/${accountId}`);
  return (
    <div className={SCREEN}>
      <PushedTitle
        title="Settings"
        back={name}
        // Back to the page these settings were opened from (its ⋯); a page opened with nothing behind it falls back
        // to the account's or the asset's own page.
        onBack={goBack}
      />
      <ErrorBox error={values.error ?? profile.error} />
      {!value && !values.isPending && <Empty>That asset is not in this workspace.</Empty>}

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
            !money && profile.data?.coretaxSection ? (
              <CoretaxFieldsGroup
                key={`fields-${accountId}`}
                profile={profile.data}
                section={profile.data.coretaxSection}
                fallbacks={heldAt ? { inst: { value: heldAt.name, from: heldFrom } } : undefined}
              />
            ) : undefined
          }
        />
      )}

      {/* A bond's coupon: its rate, how often and from when it pays, and whether the app records it on the day. */}
      {profile.data?.assetKind === 'bond' && <CouponGroup accountId={accountId} heldAtId={link?.brokerAccountId ?? null} />}

      {/* A broker's cash account says what the broker charges, for the Buy and Sell sheets. */}
      {account?.subtype === 'fund' && <BrokerFeesGroup accountId={accountId} />}
      {/* A digital wallet says which phone number it is tied to, by its last four digits. */}
      {account?.subtype === 'ewallet' && <WalletPhoneGroup accountId={accountId} />}
      {/* A bank account says which account number it is, by its last four digits. */}
      {(account?.subtype === 'bank' || account?.subtype === 'savings') && <BankNumberGroup accountId={accountId} />}

      {/* A money account's tax fields stay here; an asset's are on its Edit screen, with its name and when it was got. */}
      {/* A money account opened before it had a profile (a broker made from Add holding) still shows its kas row: saving a
          field gives it the profile Add account would have. */}
      {money && profile.isSuccess && (
        <CoretaxFieldsGroup
          key={`fields-${accountId}`}
          profile={profile.data ?? { ...profileDefaults('cash'), coretaxSection: 'kas', coretaxCode: cashCodeFor(account?.subtype), accountId, workspaceId: ws.workspaceId, updatedAt: '' }}
          section={profile.data?.coretaxSection ?? 'kas'}
        />
      )}

      {value && (
        <>
          <InsetGroup footer={archivable ? undefined : 'Archiving is available once nothing is left in this asset.'}>
            <InsetRow
              title="Archive"
              chevron={false}
              disabled={!archivable}
              onClick={() => void leaveBy(`Archive ${name}? It leaves the list; its history stays in reports.`, () => archiveAccount(database, ws, accountId))}
            />
            <InsetRow
              title="Delete"
              chevron={false}
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
