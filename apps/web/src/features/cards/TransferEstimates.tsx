import { convertDetail, type TransferPartner } from '@expanses/core';
import { InsetGroup, InsetRow } from '../../ui/native';
import { activeDuring } from './catalog-panel';
import { capNote } from './transfer-summary';
import { formatPoints } from './useCardPoints';

/** What the cycle's points would convert to at each partner available today, in whole transfer steps. */
export function TransferEstimates({ partners, points, unit, today }: { partners: TransferPartner[]; points: number; unit: string; today: string }) {
  const available = partners.filter((partner) => activeDuring(partner, today, today));
  if (available.length === 0 || points <= 0) return null;
  return (
    <InsetGroup header={`This cycle's ${unit} transfer to`}>
      {available.map((partner) => {
        const detail = convertDetail(Math.floor(points), partner);
        const note = capNote(partner, detail, unit);
        return <InsetRow key={partner.id} title={<span className="tabular">{`${formatPoints(detail.units)} ${partner.program}`}</span>} subtitle={note ?? undefined} />;
      })}
    </InsetGroup>
  );
}
