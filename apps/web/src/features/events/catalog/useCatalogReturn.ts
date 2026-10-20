import { useCallback, useEffect, useRef, useState, type MouseEventHandler, type RefObject } from 'react';
import { useSession } from '../../auth/SessionProvider';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { catalogPositionMemory } from './return-position';

export function useCatalogReturn(url: string, root: RefObject<HTMLDivElement | null>) {
  useSession();
  const epoch = sessionEpoch();
  // Reading is pure: StrictMode may invoke an initializer twice.
  const [initial] = useState(() => catalogPositionMemory.read(url, epoch));
  const pending = useRef(initial);
  const current = useRef({ url, epoch });
  current.current = { url, epoch };
  const frame = useRef<number | undefined>(undefined);
  useEffect(() => {
    catalogPositionMemory.clear();
    if (pending.current?.url !== url || pending.current.epoch !== epoch) pending.current = undefined;
  }, [url, epoch]);
  useEffect(() => () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); frame.current = undefined; }, []);

  const remember: MouseEventHandler<HTMLAnchorElement> = useCallback((event) => {
    // Opening another tab must not arm restoration in the original tab.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const card = event.currentTarget.closest<HTMLElement>('[data-event-id]');
    const link = event.currentTarget.dataset.catalogLink;
    if (!card?.dataset.eventId || (link !== 'title' && link !== 'action')) return;
    catalogPositionMemory.save({ url, epoch: sessionEpoch(), eventId: card.dataset.eventId, offset: card.getBoundingClientRect().top, link });
  }, [url]);

  const restore = useCallback(() => {
    const saved = pending.current;
    if (!saved) return;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    // Wait until the refreshed pages and the shell's route focus have settled.
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      pending.current = undefined;
      if (saved.url !== current.current.url || saved.epoch !== current.current.epoch || saved.epoch !== sessionEpoch() || !root.current?.isConnected) return;
      const active = document.activeElement;
      const main = root.current.closest('main');
      if (active !== document.body && active !== main && active !== root.current.querySelector('h1')) return;
      const card = [...root.current.querySelectorAll<HTMLElement>('[data-event-id]')].find((element) => element.dataset.eventId === saved.eventId);
      const link = card?.querySelector<HTMLElement>(`[data-catalog-link="${saved.link}"]`);
      if (card && link) {
        link.focus({ preventScroll: true });
        window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - saved.offset), behavior: 'auto' });
      } else {
        // The publication may have disappeared. Never fetch old pages to resurrect it.
        const heading = root.current.querySelector<HTMLElement>('[data-catalog-results-title]');
        heading?.focus({ preventScroll: true });
        heading?.scrollIntoView({ block: 'start', behavior: 'auto' });
      }
    });
  }, [root]);
  return { remember, restore };
}
