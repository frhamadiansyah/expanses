import { Link } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { useOpenReceipt } from './ReceiptPeekHost';

/**
 * The way into a receipt on a desktop: an ⓘ at the end of the row, in the list and in the table alike (an account's
 * history; Cashflow's table opens its peek on a click instead). On a wide screen it opens the Mac receipt, the side
 * peek, over the list; on a phone held sideways, the receipt page.
 *
 * `hidden md:inline-flex` because the phone reaches a receipt by tapping the row (Task 9), and a row with two
 * targets on a touch screen is a row you press the wrong half of. **Nothing about editing on a desktop
 * changes**: the row's own click still opens the in-place editor, which is why this stops the click from
 * reaching it — pressing ⓘ must not also arm an editor on the row being left behind.
 */
export function ReceiptLink({ transactionId, description }: { transactionId: string; description: string }) {
  const openReceipt = useOpenReceipt();
  return (
    <Link
      to="/transactions/$transactionId"
      params={{ transactionId }}
      aria-label={`Receipt for ${description}`}
      title="Open the receipt"
      onClick={(event) => {
        event.stopPropagation();
        if (!openReceipt) return;
        event.preventDefault();
        openReceipt(transactionId);
      }}
      className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-slate-900 md:inline-flex"
    >
      <Info size={16} aria-hidden />
    </Link>
  );
}
