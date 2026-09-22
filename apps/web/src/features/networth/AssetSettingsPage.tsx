import { taxTreatmentOf } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { useAccounts } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { LargeTitle, Panel, SCREEN } from '../../ui/native';
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
  const values = useAssetValues();
  const profile = useAssetProfile(accountId);
  const accounts = useAccounts();
  const links = useHoldingLinks();
  const securities = useSecurities();

  const value = values.data?.find((row) => row.accountId === accountId);
  const account = (accounts.data ?? []).find((row) => row.id === accountId);
  // A holding linked to a security takes its lot size from the security, so the box is not offered.
  const linkedToSecurity = (links.data ?? []).some((link) => link.accountId === accountId && link.securityId !== null);

  return (
    <div className={SCREEN}>
      <LargeTitle
        title="Settings"
        back={value?.name ?? account?.name ?? 'Asset'}
        backTo="/net-worth/assets/$accountId"
        backParams={{ accountId }}
      />
      <ErrorBox error={values.error ?? profile.error} />
      {!value && !values.isPending && <Empty>That asset is not in this workspace.</Empty>}

      {/* Only once the profile is in: the form fills its boxes when it mounts, and an empty code reads as "type one". */}
      {value && !profile.isPending && (
        <AssetSettings
          key={accountId}
          accountId={accountId}
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
    </div>
  );
}
