import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type components } from '../../shared/api/client';

export function usePresets(enabled: boolean) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; items: components['schemas']['AvatarPreset'][] }>({ status: 'loading', items: [] });
  const current = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setState((previous) => ({ ...previous, status: 'loading' }));
    try {
      const result = await api.GET('/avatar-presets', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), cache: 'no-store' });
      if (controller.signal.aborted) return;
      if (result.response.status !== 200 || !result.data) throw new Error('Catalog unavailable');
      setState({ status: 'ready', items: result.data.items });
    } catch {
      if (!controller.signal.aborted) setState((previous) => ({ ...previous, status: 'error' }));
    }
  }, []);
  useEffect(() => {
    if (enabled) void reload();
    return () => current.current?.abort();
  }, [enabled, reload]);
  return { ...state, reload };
}
