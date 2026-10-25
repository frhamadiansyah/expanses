import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useWalletSlot } from '../../ui/native';
import { backLayout, backRadius } from './balance-back';
import { BalanceBody, BalanceCard, type BalanceCardProps } from './BalanceCard';

/**
 * An account's balance, where the page puts it. Opened from Wallet the raised card is the page's hero, and the balance
 * is the card's back: a tap turns the card over to a white face of the card's own size with the balance on it, and
 * back. Opened any other way (Net worth, a pocket, a deposit) there is no card on the page, so the balance stays the
 * white box it always was.
 *
 * The back is drawn here, in the page's tree, into the element the stack keeps on the raised card (`slot.backHost`),
 * so the figure, its approximate mark, the pockets' label and the line are the page's own, unchanged.
 */
export function BalanceHero({ foreign, ...props }: BalanceCardProps & { foreign?: ReactNode }) {
  const slot = useWalletSlot();
  const setFlippable = slot?.setFlippable;
  useEffect(() => {
    setFlippable?.(true);
    return () => setFlippable?.(false);
  }, [setFlippable]);

  if (!slot) {
    return (
      <BalanceCard
        {...props}
        caption={
          <>
            <span className="block">{props.caption}</span>
            {foreign}
          </>
        }
      />
    );
  }
  if (!slot.backHost) return null;
  const { testId, caption, children, corner, ...rest } = props;
  // The account line, and the foreign-money line under it where the page has one and the card has room for it.
  const layout = backLayout(slot.height, foreign ? 2 : 1);
  return createPortal(
    <div
      data-testid={testId}
      className="h-full w-full overflow-hidden bg-[var(--ph-surface)] text-[var(--ph-ink)]"
      style={{ borderRadius: backRadius(slot.width), padding: 14 }}
    >
      <BalanceBody
        {...rest}
        // The flip button has the card's corner, so the flag stands beside it, and the figure leaves room for both.
        className="space-y-2 [&_[data-testid=card-figure]]:pr-[84px]"
        corner={corner ? <span className="mr-10 block">{corner}</span> : undefined}
        caption={
          <>
            <span className="block">{caption}</span>
            {layout.foreign && foreign}
          </>
        }
        series={layout.spark === null ? null : rest.series}
        plot={layout.spark ?? undefined}
      >
        {children}
      </BalanceBody>
    </div>,
    slot.backHost,
  );
}
