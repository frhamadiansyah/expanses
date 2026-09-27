import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { LargeTitle, SCREEN } from '../../ui/native';
import { JoinWorkspace } from './JoinWorkspace';

const route = getRouteApi('/join/$code');

/**
 * Where a `cicis://join/…` link lands (spec §11): the shell's URL handler and the web address `/join/<code>` both open
 * this screen with the code filled in, and it asks for the preview at once.
 */
export function JoinPage() {
  const { code } = route.useParams();
  const { switchBook } = useApp();
  const navigate = useNavigate();
  return (
    <div className={SCREEN}>
      <LargeTitle title="Join a workspace" back="Cashflow" backTo="/transactions" />
      <JoinWorkspace
        initialCode={code}
        onJoined={async (bookId) => {
          await switchBook(bookId);
          await navigate({ to: '/transactions' });
        }}
      />
    </div>
  );
}
