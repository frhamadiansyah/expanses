import { Navigate, useParams } from '@tanstack/react-router';

/**
 * Edit was folded into Settings, which now holds an asset's name, when it was acquired and everything the tax report
 * asks of it, each saved when it is left. An old link to Edit lands there.
 */
export function EditAssetRoute() {
  const { accountId } = useParams({ from: '/net-worth/assets/$accountId/edit' });
  return <Navigate to="/net-worth/assets/$accountId/settings" params={{ accountId }} replace />;
}
