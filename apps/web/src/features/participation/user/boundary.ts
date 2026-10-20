import { useEffect, useRef } from 'react';

/** One canonical reread at the start, not a local change of business status. */
export function useEventBoundary(startsAt: string | undefined, refresh: () => void) {
  const callback = useRef(refresh); callback.current = refresh;
  useEffect(() => {
    if (!startsAt) return;
    const target = Date.parse(startsAt);
    if (!Number.isFinite(target) || target <= Date.now()) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const remaining = target - Date.now();
      if (remaining <= 0) callback.current();
      else timer = setTimeout(arm, Math.min(2_147_483_647, remaining + 50));
    };
    arm();
    return () => clearTimeout(timer);
  }, [startsAt]);
}
