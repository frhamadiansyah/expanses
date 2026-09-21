import { searchSecurities } from '@expanses/catalog';
import type { SecurityRow } from '@expanses/db';
import { formatUnits } from '@expanses/core';
import { useEntitlement } from '../../lib/entitlements';
import { Input } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import type { Picked } from './add-holding';
import { useSecurityList } from './queries';

export function SecuritySearch({ query, onQuery, held, heldUnits, onPick, onNameIt }: {
  query: string;
  onQuery: (q: string) => void;
  held: readonly SecurityRow[];
  /** Units held per security id, for "you hold 10". */
  heldUnits: Readonly<Record<string, number>>;
  onPick: (picked: Picked) => void;
  onNameIt: () => void;
}) {
  const foreign = useEntitlement('foreign_securities');
  const idx = useSecurityList('idx', true);
  const us = useSecurityList('us', foreign);
  const mine = searchSecurities(held, query);
  const mineKeys = new Set(mine.map((s) => `${s.market}:${s.ticker}`));
  const listed = searchSecurities([...(idx.data?.securities ?? []), ...(foreign ? (us.data?.securities ?? []) : [])], query).filter((s) => !mineKeys.has(`${s.market}:${s.ticker}`));
  const searching = query.trim() !== '';
  const failed = idx.isError || (foreign && us.isError);
  return (
    <>
      <Input aria-label="Ticker or name" placeholder="Ticker or name" value={query} onChange={(e) => onQuery(e.target.value)} autoFocus />
      {mine.length > 0 && (
        <InsetGroup header="You hold">
          {mine.map((s) => (
            <InsetRow key={s.id} title={s.ticker ?? s.name} subtitle={[s.name, s.market, s.currency, heldUnits[s.id] ? `you hold ${formatUnits(heldUnits[s.id]!)}` : null].filter(Boolean).join(' · ')} onClick={() => onPick({ kind: 'held', security: s })} />
          ))}
        </InsetGroup>
      )}
      {searching && (
        <InsetGroup header="Shares & funds">
          {listed.length === 0 && mine.length === 0 ? (
            <InsetRow title={`Nothing on ${foreign ? 'the lists' : 'IDX'} matches ${query.trim().toUpperCase()}`} chevron={false} />
          ) : (
            listed.map((s) => (
              <InsetRow key={`${s.market}:${s.ticker}`} title={s.ticker} subtitle={[s.name, s.market, s.currency, s.lotSize ? null : 'no lot size'].filter(Boolean).join(' · ')} onClick={() => onPick({ kind: 'listed', security: s })} />
            ))
          )}
        </InsetGroup>
      )}
      {failed && <p className="px-[4px] text-[12.5px] text-[var(--ph-warn)]">The ticker list could not be read. Name it yourself instead.</p>}
      <InsetGroup header="Not listed?">
        <InsetRow title="Name it myself" subtitle="Unlisted shares, a private fund, anything else" onClick={onNameIt} />
      </InsetGroup>
    </>
  );
}
