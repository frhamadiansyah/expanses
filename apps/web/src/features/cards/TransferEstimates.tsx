import { convertPoints, type TransferPartner } from '@expanses/core';
import { activeDuring } from './catalog-panel';
import { formatPoints } from './useCardPoints';

/** What the cycle's points would convert to at each partner available today, in whole transfer steps. */
export function TransferEstimates({ partners, points, unit, today }: { partners: TransferPartner[]; points: number; unit: string; today: string }) {
  const available = partners.filter((partner) => activeDuring(partner, today, today));
  if (available.length === 0 || points <= 0) return null;
  return (
    <div className="mt-3 text-sm">
      <div className="text-xs text-slate-500">This cycle's {unit} transfer to</div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {available.map((partner) => (
          <li key={partner.id} className="tabular">
            {formatPoints(convertPoints(Math.floor(points), partner))} {partner.program}
          </li>
        ))}
      </ul>
    </div>
  );
}
