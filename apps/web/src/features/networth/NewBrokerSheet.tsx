import { useState } from 'react';
import { Sheet as SheetFrame } from '../../app/Sheet';
import { InsetGroup, SubmitRow, TextRow } from '../../ui/native';

/** The Broker row's choice that opens a broker by name rather than picking one. */
export const NEW_BROKER = 'new-broker';

/** A broker not in the app yet, named and opened where a holding is kept. */
export function NewBrokerSheet({ onSave, onClose }: { onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <SheetFrame grouped title="New broker" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <InsetGroup footer="Opened as a broker's cash account, as Add a holding opens one. Its RDN bank is named in its Settings.">
          <TextRow label="Broker name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Required" required />
        </InsetGroup>
        <InsetGroup>
          <SubmitRow label="Add broker" disabled={!name.trim()} />
        </InsetGroup>
      </form>
    </SheetFrame>
  );
}
