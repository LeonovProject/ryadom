import { safeReturnTo } from '../../auth/return-to';

function stateRecord(state: unknown): Record<string, unknown> {
  return typeof state === 'object' && state !== null ? state as Record<string, unknown> : {};
}

export function catalogReturnTo(state: unknown): string {
  const raw = stateRecord(state).catalogReturnTo;
  const target = typeof raw === 'string' ? safeReturnTo(raw) : '/events';
  return target === '/events' || target.startsWith('/events?') ? target : '/events';
}

export function profileReturnTo(state: unknown) {
  const raw = stateRecord(state).eventReturnTo;
  if (typeof raw === 'string' && /^\/events\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return { to: raw, label: '← К встрече', state: { catalogReturnTo: catalogReturnTo(state) } };
  }
  return { to: '/events', label: '← К встречам', state: undefined };
}
