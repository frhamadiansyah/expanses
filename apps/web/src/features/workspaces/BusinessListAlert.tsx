import { ALERT_ROW, NoticeAlert } from '../../ui/native/NoticeAlert';

/** The offer to start a Business workspace's categories from the business list; the caller applies it. */
export function BusinessListAlert({ onUse, onClose }: { onUse: () => void; onClose: () => void }) {
  return (
    <NoticeAlert
      title="Use the Business list"
      text="Adds the business categories and archives the unused personal ones. Categories with transactions stay."
      actions={
        <button
          type="button"
          data-testid="use-business-list-confirm"
          onClick={() => {
            onClose();
            onUse();
          }}
          className={`${ALERT_ROW} font-semibold`}
        >
          Use the Business list
        </button>
      }
      closeLabel="Not now"
      onClose={onClose}
    />
  );
}
