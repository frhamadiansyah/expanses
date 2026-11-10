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
export function LinkAmount({ link, goalCurrency }: { link: GoalLinkRow; goalCurrency?: string }) {
  const { ws } = useApp();
  // The translation is into the goal's own money, which is the base unless the goal has a currency of its own.
  const into = goalCurrency ?? ws.baseCurrency;
  if (link.currency === into) return <Money minor={link.valueMinor} currency={link.currency} />;
  return (
    <>
      <Money minor={link.valueMinor} currency={link.currency} />
      {link.goalMinor === null ? (
        <> · no {into} rate yet</>
      ) : (
        <>
          {' ('}
          <Money minor={link.goalMinor} currency={into} />
          {')'}
        </>
      )}
    </>
  );
}

/** What funds a goal, as one row of its group, opening that account or holding. Named so the group can hand it its place and a test can name it. */
export function FundingRow({ link, goalCurrency, caption, position }: GroupChild & { link: GoalLinkRow; goalCurrency?: string; caption?: string }) {
  // Another member's line is read-only here: its account is on their phone, so the row opens nothing.
  const theirs = link.owner !== undefined;
  return (
    <div data-testid="goal-link">
      <InsetRow
        position={position}
        title={link.name}
        // Only a shortfall earns a second line; "set aside" and "tagged" are what the group's own name already says.
        subtitle={
          caption ? (
            caption
          ) : link.kind !== 'tagged' && link.shortMinor > 0 ? (
            <>
              short by <Money minor={link.shortMinor} currency={link.currency} />
            </>
          ) : undefined
        }
        value={<LinkAmount link={link} goalCurrency={goalCurrency} />}
        valueTone="ink"
        // The account or holding's own page: a money account's page is reached through the same address.
        to={theirs ? undefined : '/net-worth/assets/$accountId'}
        params={theirs ? undefined : { accountId: link.accountId }}
      />
    </div>
  );
}
