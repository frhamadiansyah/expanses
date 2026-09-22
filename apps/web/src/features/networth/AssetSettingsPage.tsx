import { deleteUnusedAccount, taxTreatmentOf } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useAccounts } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, LargeTitle, Panel, SCREEN } from '../../ui/native';
import { useHoldingLinks, useSecurities } from '../investments/queries';
import { AssetSettings } from './AssetSettings';
import { CoretaxFieldsForm } from './CoretaxFieldsForm';
import { useAssetProfile, useAssetValues } from './queries';

export function AssetSettingsRoute() {
  const { accountId } = useParams({ from: '/net-worth/assets/$accountId/settings' });
  return <AssetSettingsPage accountId={accountId} />;
}

/**
 * An asset's settings on a page of their own: what it counts as, its tax treatment and its tax-report code —
 * and, for the things the DJP form asks more of, the fields that form wants. They used to sit at the bottom
 * of the asset's page, under a chart and a history, for the once or twice a year anyone changes them; the
 * gear in the page's top corner is where iOS keeps them, and where they live now.
 */
export function AssetSettingsPage({ accountId }: { accountId: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const values = useAssetValues();
  const profile = useAssetProfile(accountId);
  const accounts = useAccounts();
  const links = useHoldingLinks();
  const securities = useSecurities();
  const [error, setError] = useState<unknown>(null);
  // The delete arms on the first tap and fires on the second: the same two taps the ledger's rows use.
  const [arming, setArming] = useState(false);

  const value = values.data?.find((row) => row.accountId === accountId);
  const account = (accounts.data ?? []).find((row) => row.id === accountId);
  // A holding linked to a security takes its lot size from the security, so the box is not offered.
  const linkedToSecurity = (links.data ?? []).some((link) => link.accountId === accountId && link.securityId !== null);

  async function remove() {
    if (!arming) {
      setArming(true);
      return;
    }
    setError(null);
    try {
      await deleteUnusedAccount(database, ws, accountId);
      await invalidate();
      await navigate({ to: '/net-worth/assets' });
    } catch (e) {
      setError(e);
      setArming(false);
    }
  }

  return (
    <div className={SCREEN}>
      <LargeTitle
        title="Settings"
        back={value?.name ?? account?.name ?? 'Asset'}
        backTo="/net-worth/assets/$accountId"
        backParams={{ accountId }}
      />
      <ErrorBox error={values.error ?? profile.error ?? error} />
      {!value && !values.isPending && <Empty>That asset is not in this workspace.</Empty>}

      {/* Only once the profile is in: the form fills its boxes when it mounts, and an empty code reads as "type one". */}
      {value && !profile.isPending && (
        <AssetSettings
          key={accountId}
          accountId={accountId}
          name={value.name}
          group={profile.data?.planGroup ?? value.planGroup}
          lotSize={profile.data?.lotSize ?? null}
          showLotSize={value.mode === 'market' && profile.data?.unitKind !== 'grams' && !linkedToSecurity}
          reportable={profile.data?.reportable ?? true}
          coretaxCode={profile.data?.coretaxCode ?? null}
          // What the thing is, for the codes two items share: a saving account must not read back as a current one.
          itemId={account?.subtype}
          // As the tax report reads it: a deposit nobody set shows final, the band its interest is reported in.
          taxTreatment={taxTreatmentOf(profile.data?.taxTreatment, account?.subtype)}
        />
      )}

      {profile.data?.coretaxSection && (
        <Panel>
          <CoretaxFieldsForm profile={profile.data} section={profile.data.coretaxSection} />
        </Panel>
      )}

      {value && (
        <InsetGroup footer="Only when it was opened by mistake: it holds nothing but its opening entry, and no goal promises its money. Otherwise move the money out, then archive it.">
          <DestructiveRow label={arming ? 'Click again to delete' : 'Delete'} onClick={() => void remove()} />
        </InsetGroup>
      )}
    </div>
  );
}
