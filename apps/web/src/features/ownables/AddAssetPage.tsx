import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { AddAssetForm } from '../networth/AddAssetForm';
import { handOverRows } from './catalogue-view';
import { OwnablePicker } from './OwnablePicker';

/**
 * Adding an asset, two levels deep: the family, then the thing — and "Something else" at the foot of a family for
 * the rest of that table, so nothing a person owns is unreachable because the five families did not name it.
 *
 * The row at the foot is what keeps money out of here: most people's first instinct is that a bank balance is an
 * asset, and it is — but one the Accounts page keeps, where it can be spent from.
 */
export function AddAssetPage() {
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <OwnablePicker
      flow="asset"
      title="New asset"
      searchPlaceholder="Search everything you can own"
      hint={
        <>
          Money you can spend — cash, bank, e-wallet, broker cash — is an <b>account</b>, not an asset.
        </>
      }
      moreHint={(family) => `Anything here is recorded as a thing you give a value to, and files under ${family.toLowerCase()} in the tax report.`}
      chosen={chosen}
      // Listed shares start from a ticker (spec §7.5); everything else opens the form here, as before.
      onChoose={(id) => (id === 'stock' ? void navigate({ to: '/net-worth/investments/new' }) : setChosen(id))}
      handOver={handOverRows('asset')}
    >
      {/* The picker lays its whole screen on the kit's ground, so the form's groups sit on it as they are. */}
      {chosen && <AddAssetForm key={chosen} itemId={chosen} onDone={() => void navigate({ to: '/net-worth/assets' })} />}
    </OwnablePicker>
  );
}
