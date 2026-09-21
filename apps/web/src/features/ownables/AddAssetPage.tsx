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
      title="What do you own?"
      searchPlaceholder="Search everything you can own"
      hint={
        <>
          Money you can spend — cash, bank, e-wallet, broker cash — is an <b>account</b>, not an asset.
        </>
      }
      moreHint={(family) => `Anything here is recorded as a thing you give a value to, and files under ${family.toLowerCase()} in the tax report.`}
      chosen={chosen}
      onChoose={setChosen}
      handOver={handOverRows('asset')}
    >
      {/* The form is the kit's groups, which are laid on the kit's grey — the picker's own shell is shared with
          `/accounts/new` and `/debts/new`, so the ground is given to the form alone rather than to that shell. */}
      {chosen && (
        <div className="ph-screen -mx-3 rounded-xl px-3 pt-3">
          <AddAssetForm key={chosen} itemId={chosen} onDone={() => void navigate({ to: '/net-worth/assets' })} />
        </div>
      )}
    </OwnablePicker>
  );
}
