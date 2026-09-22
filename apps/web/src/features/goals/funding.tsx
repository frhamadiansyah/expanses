import { formatUnits } from '@expanses/core';
import type { GoalLinkRow } from '@expanses/db';
import { useApp } from '../../app/context';
import { Money } from '../../ui';
import { type GroupChild, InsetRow } from '../../ui/native';

/**
 * What one link is worth, in the money it actually is.
 *
 * `link.valueMinor` is the account's own currency — a US$100,03 set-aside is 10_003 — and this used to be
 * painted under a hardcoded `ws.baseCurrency`, so the chip read `Rp 10.003`. The figure is shown in its own
 * currency, with the base-currency translation beside it when a rate is known and a plain word when it is
 * not. There is one of these because there used to be two, and only one of them would ever have been fixed.
 */
export function LinkAmount({ link }: { link: GoalLinkRow }) {
  const { ws } = useApp();
  if (link.currency === ws.baseCurrency) return <Money minor={link.valueMinor} currency={link.currency} />;
  return (
    <>
      <Money minor={link.valueMinor} currency={link.currency} />
      {link.baseMinor === null ? (
        <> · no {ws.baseCurrency} rate yet</>
      ) : (
        <>
          {' ('}
          <Money minor={link.baseMinor} currency={ws.baseCurrency} />
          {')'}
        </>
      )}
    </>
  );
}

/** What funds a goal, as one row of its group. Named so the group can hand it its place and a test can name it. */
export function FundingRow({ link, position }: GroupChild & { link: GoalLinkRow }) {
  return (
    <div data-testid="goal-link">
      <InsetRow
        position={position}
        title={link.name}
        subtitle={
          link.kind === 'tagged' && link.unitsMicro !== null ? (
            `${formatUnits(link.unitsMicro)} tagged`
          ) : link.shortMinor > 0 ? (
            <>
              set aside · short by <Money minor={link.shortMinor} currency={link.currency} />
            </>
          ) : (
            'set aside'
          )
        }
        value={<LinkAmount link={link} />}
        valueTone="ink"
        chevron={false}
      />
    </div>
  );
}
