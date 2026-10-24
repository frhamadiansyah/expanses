import { useBack } from '../../app/BackHeader';
import { PushedTitle, SCREEN } from '../../ui/native';
import { PointsSection } from './PointsSection';

/**
 * The points programmes, a page of their own opened from Wallet's corner: Wallet is the cards, and a programme is a
 * balance the cards earn into rather than a card. Each row opens the programme's page, whose ‹ comes back here.
 */
export function PointsPage() {
  const goBack = useBack('/wallet');
  return (
    <div className={SCREEN}>
      <PushedTitle title="Points" back="Wallet" onBack={goBack} />
      <PointsSection />
    </div>
  );
}
