import { CASH_ITEMS } from '@expanses/core';
import { archiveAccount, deleteUnusedAccount, taxTreatmentOf } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useAccounts } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { useBack } from '../../app/BackHeader';
import { useHoldingLinks } from '../investments/queries';
import { AssetSettings } from './AssetSettings';
import { BrokerFeesGroup } from './BrokerFeesGroup';
import { CoretaxFieldsGroup } from './CoretaxFieldsGroup';
import { useAssetProfile, useAssetValues } from './queries';

/** The kinds of money account, whose own page is on `/accounts` rather than the asset list. */
const CASH_SUBTYPES = new Set<string>(CASH_ITEMS.map((item) => item.id));

export function AssetSettingsRoute() {
  const { accountId } = useParams({ from: '/net-worth/assets/$accountId/settings' });
  return <AssetSettingsPage accountId={accountId} />;
}

/**
 * An account's or an asset's settings on a page of their own: its name, what it counts as, its tax treatment and its
 * tax-report code, and the fields the DJP form asks of its table. They are changed once or twice a year, so they wait
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
  const [error, setError] = useState<unknown>(null);

  const value = values.data?.find((row) => row.accountId === accountId);
  const account = (accounts.data ?? []).find((row) => row.id === accountId);
  const money = account !== undefined && CASH_SUBTYPES.has(account.subtype);
  // A holding linked to a security takes its lot size from the security, so the row is not offered.
  const linkedToSecurity = (links.data ?? []).some((link) => link.accountId === accountId && link.securityId !== null);
  const name = value?.name ?? account?.name ?? 'Asset';
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
        />
      )}

      {/* A broker's cash account says what the broker charges, for the Buy and Sell sheets. */}
      {account?.subtype === 'fund' && <BrokerFeesGroup accountId={accountId} />}

      {profile.data?.coretaxSection && <CoretaxFieldsGroup key={`fields-${accountId}`} profile={profile.data} section={profile.data.coretaxSection} />}

      {value && (
        <>
          <InsetGroup>
            <InsetRow
              title="Archive"
              chevron={false}
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
