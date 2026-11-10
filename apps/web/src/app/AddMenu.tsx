import { useNavigate } from '@tanstack/react-router';
import { InsetGroup, InsetRow } from '../ui/native/InsetList';
import { Sheet } from './Sheet';

/**
 * What holding the tab bar's ＋ opens: the other ways in, beside the Add form a plain tap still opens. Scan a receipt is
 * the same action as Cashflow's own button and the widget's Receipt: it opens Cashflow, which starts the scan.
 */
export function AddMenu({ onClose, onAdd }: { onClose: () => void; onAdd: () => void }) {
  const navigate = useNavigate();
  const go = (to: () => void) => () => {
    onClose();
    to();
  };
  return (
    <Sheet title="Add" onClose={onClose} grouped>
      <InsetGroup>
        <InsetRow title="One line" onClick={go(() => void navigate({ to: '/transactions/line' }))} />
        <InsetRow title="Paste a list" onClick={go(() => void navigate({ to: '/transactions/paste' }))} />
        <InsetRow title="Scan a receipt" onClick={go(() => void navigate({ to: '/transactions', search: { scan: true } }))} />
        <InsetRow title="Add transaction" onClick={go(onAdd)} />
      </InsetGroup>
    </Sheet>
  );
}
