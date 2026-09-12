import { Link, useParams } from '@tanstack/react-router';
import { Card, Empty, ErrorBox, Money, PageHeader } from '../../ui';
import { CORETAX_SECTION_LABELS, METHOD_LABELS } from './labels';
import { useAssetProfile, useAssetValues } from './queries';

export function AssetDetailPage() {
  const params = useParams({ strict: false }) as { accountId?: string };
  const accountId = params.accountId ?? '';
  const values = useAssetValues();
  const profile = useAssetProfile(accountId);
  const value = values.data?.find((row) => row.accountId === accountId);

  return (
    <div className="space-y-4">
      <PageHeader
        title={value?.name ?? 'Asset'}
        action={
          <Link to="/net-worth/assets" className="text-sm text-slate-600 hover:text-slate-900">
            Back to assets
          </Link>
        }
      />
      <ErrorBox error={values.error ?? profile.error} />
      {!value && !values.isPending && <Empty>That asset is not in this workspace.</Empty>}
      {value && (
        <Card className="space-y-2">
          <div className="text-2xl font-semibold">
            <Money minor={value.valueMinor} currency={value.currency} />
          </div>
          <div className="text-sm text-slate-600">
            Cost <Money minor={value.costMinor} currency={value.currency} /> · {METHOD_LABELS[value.mode]}
            {value.asOf && ` · as of ${value.asOf}`}
          </div>
          {profile.data?.coretaxSection && (
            <div className="text-sm text-slate-500">
              Coretax: {profile.data.coretaxCode} · {CORETAX_SECTION_LABELS[profile.data.coretaxSection] ?? profile.data.coretaxSection}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
