import type { components } from '../../../shared/api/client';
import { formatEventStart } from '../../../shared/lib/event-time';

type Event = components['schemas']['EventDetail'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function invitationUrl(origin: string, id: string) {
  const base = new URL(origin);
  if (!uuid.test(id) || !['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Некорректная ссылка на встречу.');
  return `${base.origin}/events/${id.toLowerCase()}`;
}
export function shortDescription(text: string) {
  const points = [...text];
  if (points.length <= 500) return { text, shortened: false };
  let end = 500;
  // A complete word ending exactly at the boundary must not be dropped.
  if (!/\s/u.test(points[500])) {
    for (let i = 499; i > 0; i--) if (/\s/u.test(points[i])) { end = i; break; }
  }
  return { text: points.slice(0, end).join('').trimEnd() + '…', shortened: true };
}
export function invitationData(event: Event, origin: string, now = Date.now()) {
  if (event.publicationStatus !== 'PUBLISHED') throw new Error('Встреча снята с публикации. Приглашение недоступно.');
  if (event.capabilities.joinBlockedReason === 'EVENT_STARTED' || Date.parse(event.startsAt) <= now) throw new Error('Встреча уже началась. Приглашение на новую запись недоступно');
  const organizer = event.organizer;
  const url = invitationUrl(origin, event.id);
  const host = new URL(url).hostname;
  // Only these public fields participate in the sheet and freshness comparison.
  return {
    title: event.title, activity: event.activityType.name, startsAt: event.startsAt,
    timezone: event.timezone, when: formatEventStart(event), city: event.city, location: event.locationText,
    organizer: organizer.type === 'PERSONAL' ? organizer.account.displayName : organizer.organization.name,
    organizerType: organizer.type,
    blocked: organizer.type === 'PERSONAL' ? organizer.account.isBlocked : organizer.ownerIsBlocked,
    description: event.description, conditions: event.conditions, mode: event.joinMode, url,
    loopback: host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host.startsWith('127.'),
  };
}
export type InvitationData = ReturnType<typeof invitationData>;
