import { InsetGroup, InsetRow, Panel, PushedTitle, SCREEN } from '../../ui/native';
import { useAttention } from './attention';

/**
 * What is waiting, on a screen of its own behind the corner that counts it.
 *
 * It was the right-hand column of the Net worth page, which on a phone is under the balance sheet: a thing that needs
 * doing, below the answer to what you have. iOS keeps this kind of screen behind a corner glyph, and the glyph carries
 * a dot when there is something behind it — so nothing is hidden by the move, and the page that is about a figure is
 * only about the figure.
 *
 * The two kinds of waiting are drawn differently because they are different things: a row is something with a screen
 * behind it, and a warning is a sentence about a rate or a date that no screen can answer.
 */
export function AttentionPage() {
  const { items, warnings } = useAttention();

  return (
    <div className={SCREEN}>
      <PushedTitle title="Needs attention" back="Net worth" backTo="/net-worth" />
      {items.length === 0 && warnings.length === 0 ? (
        <Panel wide>
          <p className="text-[13px] leading-[17px] text-[var(--ph-ink-3)]">Nothing waiting. Prices and estimates are fresh.</p>
        </Panel>
      ) : (
        <>
          {items.length > 0 && (
            <InsetGroup wide>
              {items.map((item) => (
                /* The row is the link it used to hold; what it was called stays, on the right, in the tint. */
                <InsetRow
                  key={item.key}
                  to={item.to}
                  params={item.params}
                  title={item.text}
                  value={item.action}
                  valueTone={item.tone === 'warn' ? 'warn' : 'tint'}
                  chevron={false}
                />
              ))}
            </InsetGroup>
          )}
          {warnings.length > 0 && (
            <div className="px-[4px] pt-[8px]">
              {warnings.map((warning) => (
                <p key={warning} className="pb-[4px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]">
                  {warning}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
