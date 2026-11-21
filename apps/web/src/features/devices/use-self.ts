import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import type { SelfStatus } from '../../sync/self-service';

/** The group and its Devices list, as the self service last read them; re-drawn on every change. */
export function useSelfStatus(): SelfStatus {
  const { self } = useApp();
  const [status, setStatus] = useState(() => self.status());
  useEffect(() => {
    const off = self.subscribe(() => setStatus(self.status()));
    void self.refresh().catch(() => undefined);
    return off;
  }, [self]);
  return status;
}

/** Calls `tick` every `ms` while mounted and `on`; the screens of a link poll the meeting place this way. */
export function usePoll(on: boolean, ms: number, tick: () => Promise<void>): void {
  useEffect(() => {
    if (!on) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (stopped) return;
      await tick().catch(() => undefined);
      if (!stopped) timer = setTimeout(() => void run(), ms);
    };
    void run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ms]);
}
