import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { JoinWorkspace } from './JoinWorkspace';

/** Join a workspace, from the switcher's + (spec §11): the same screen the link opens, as a sheet over the switcher. */
export function JoinSheet({ onClose }: { onClose: () => void }) {
  const { switchBook } = useApp();
  return (
    <Sheet grouped title="Join a workspace" onClose={onClose}>
      <JoinWorkspace
        onJoined={async (bookId) => {
          await switchBook(bookId);
          onClose();
        }}
      />
    </Sheet>
  );
}
