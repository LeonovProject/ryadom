import type { components } from '../api/client';

type EventTime = Pick<components['schemas']['PublishedEventSummary'], 'startsAt' | 'timezone'>;

/** Both the calendar date and the offset belong to the event, including DST. */
export function formatEventStart({ startsAt, timezone }: EventTime): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) throw new RangeError('Некорректное начало встречи');

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'shortOffset',
  }).format(date);
}
