import type { components } from '../../../shared/api/client';
import { resolveLocalTime } from './local-time';

export type EventValues = {
  organizerId: string; title: string; activityMode: 'list' | 'custom'; activityId: string; activityLabel: string; activityName: string;
  description: string; localStart: string; timezone: string; city: string; locationText: string;
  conditions: string; joinMode: components['schemas']['JoinMode'] | '';
};
export type EventField = keyof EventValues;
export type EventErrors = Partial<Record<EventField, string>>;
export const firstStepFields: EventField[] = ['organizerId', 'title', 'activityId', 'activityName', 'description', 'localStart', 'timezone', 'city', 'locationText'];
export function emptyEvent(organizerId = ''): EventValues {
  return { organizerId, title: '', activityMode: 'list', activityId: '', activityLabel: '', activityName: '', description: '', localStart: '',
    timezone: 'Asia/Krasnoyarsk', city: '', locationText: '', conditions: '', joinMode: '' };
}

export function validateEvent(values: EventValues, organizations: components['schemas']['OwnedOrganizationRef'][], now = Date.now()): EventErrors {
  const errors: EventErrors = {};
  const text = (field: EventField, limit: number, required = true) => {
    const value = values[field].trim();
    if (required && !value) errors[field] = 'Заполни это поле.';
    else if ([...value].length > limit) errors[field] = `Не больше ${limit} символов.`;
  };
  text('title', 160); text('description', 10_000); text('city', 120); text('locationText', 1000); text('conditions', 4000, false); text('timezone', 80);
  if (values.organizerId && !organizations.some((org) => org.id === values.organizerId && org.canPublish && org.approvalState === 'APPROVED')) {
    errors.organizerId = 'Публикация доступна только от своей допущенной организации. Выбери допустимого автора.';
  }
  if (values.activityMode === 'custom') text('activityName', 100);
  else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values.activityId)) errors.activityId = 'Выбери направление из списка или укажи своё.';
  if (!errors.timezone) {
    const time = resolveLocalTime(values.localStart, values.timezone.trim());
    if (time.error) errors.localStart = time.error;
    else if (new Date(time.startsAt!).getTime() <= now) errors.localStart = 'Начало встречи должно быть в будущем. Окончательно время проверит сервер.';
  }
  if (!values.joinMode) errors.joinMode = 'Выбери режим записи.';
  return errors;
}

export function eventInput(values: EventValues): components['schemas']['CreateEventInput'] {
  const time = resolveLocalTime(values.localStart, values.timezone.trim());
  if (!time.startsAt || !values.joinMode) throw new Error('Invalid event draft');
  return {
    organizer: values.organizerId ? { type: 'ORGANIZATION', organizationId: values.organizerId } : { type: 'PERSONAL' },
    activityType: values.activityMode === 'list' ? { id: values.activityId } : { name: values.activityName.trim() },
    title: values.title.trim(), description: values.description.trim(), city: values.city.trim(), locationText: values.locationText.trim(),
    conditions: values.conditions.trim(), timezone: values.timezone.trim(), startsAt: time.startsAt, joinMode: values.joinMode,
  };
}

export function serverFieldErrors(fields: Record<string, string[]>): EventErrors {
  const names: Record<string, EventField> = { '/organizer': 'organizerId', '/organizer/organizationId': 'organizerId', '/activityType': 'activityId',
    '/activityType/id': 'activityId', '/activityType/name': 'activityName', '/title': 'title', '/description': 'description', '/city': 'city',
    '/locationText': 'locationText', '/conditions': 'conditions', '/timezone': 'timezone', '/startsAt': 'localStart', '/joinMode': 'joinMode' };
  const result: EventErrors = {};
  for (const [pointer, messages] of Object.entries(fields)) if (names[pointer] && messages.length) result[names[pointer]] = messages.join(' ');
  return result;
}
