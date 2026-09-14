import { convertDetail, type TransferPartner } from '@expanses/core';
import { activeDuring } from './catalog-panel';
import { capNote } from './transfer-summary';
import { formatPoints } from './useCardPoints';

/** What the cycle's points would convert to at each partner available today, in whole transfer steps. */
export function TransferEstimates({ partners, points, unit, today }: { partners: TransferPartner[]; points: number; unit: string; today: string }) {
  const available = partners.filter((partner) => activeDuring(partner, today, today));
  if (available.length === 0 || points <= 0) return null;
  return (
    <div className="mt-3 text-sm">
      <div className="text-xs text-slate-500">This cycle's {unit} transfer to</div>
      <ul className="flex flex-col gap-y-1">
        {available.map((partner) => {
          const detail = convertDetail(Math.floor(points), partner);
          const note = capNote(partner, detail, unit);
          return (
            <li key={partner.id} className="tabular">
              {formatPoints(detail.units)} {partner.program}
              {note ? <span className="ml-2 text-xs text-slate-500">{note}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
