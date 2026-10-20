import type { operations } from '../../../shared/api/client';

export type EventQuery = NonNullable<operations['listEvents']['parameters']['query']>;
export type FilterDraft = { q: string; city: string; activityTypeId: string; joinMode: string; firstDay: string; lastDay: string };
const visibleKeys = ['q', 'city', 'activityTypeId', 'joinMode', 'dateFrom', 'dateTo'] as const;
const knownKeys = [...visibleKeys, 'from', 'to', 'organizationId', 'organizerAccountId', 'limit', 'cursor'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function daysInMonth(year: number, month: number) {
  return [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Calendar arithmetic deliberately avoids Date and the device timezone. */
export function adjacentDay(value: string, step: 1 | -1): string {
  if (!isCalendarDate(value)) throw new RangeError('Укажи существующую календарную дату.');
  let [year, month, day] = value.split('-').map(Number);
  day += step;
  if (day > daysInMonth(year, month)) { day = 1; month++; if (month > 12) { month = 1; year++; } }
  if (day < 1) { month--; if (month < 1) { month = 12; year--; } day = daysInMonth(year, month); }
  if (year < 1 || year > 9999) throw new RangeError('Выбери дату внутри поддерживаемого календаря.');
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isInstant(value: string) {
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value);
  return !!match && Number(match[1]) < 24 && Number(match[2]) < 60 && Number(match[3]) < 60
    && isCalendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

export function parseCatalogSearch(search: string, defaultFrom: string): { query: EventQuery; error: string | null } {
  const params = new URLSearchParams(search);
  const query: EventQuery = { limit: 12, from: defaultFrom };
  for (const key of knownKeys) {
    if (params.getAll(key).length > 1) return { query, error: 'В ссылке повторяется один из фильтров. Сбрось фильтры и выбери их заново.' };
  }
  for (const key of ['q', 'city'] as const) {
    const value = params.get(key)?.trim();
    if (value) query[key] = value;
    if (value && Array.from(value).length > (key === 'q' ? 200 : 120)) return { query, error: 'Поисковый текст или название города слишком длинные.' };
  }
  for (const key of ['activityTypeId', 'organizationId', 'organizerAccountId'] as const) {
    if (!params.has(key)) continue;
    const value = params.get(key)!;
    if (!uuid.test(value)) return { query, error: 'В ссылке указан неверный идентификатор фильтра.' };
    query[key] = value;
  }
  if (query.organizationId && query.organizerAccountId) return { query, error: 'Выбери одного организатора: человека или организацию.' };
  if (params.has('joinMode')) {
    const mode = params.get('joinMode');
    if (mode !== 'OPEN' && mode !== 'APPROVAL') return { query, error: 'В ссылке указан неизвестный режим записи.' };
    query.joinMode = mode;
  }
  for (const key of ['from', 'to'] as const) {
    if (!params.has(key)) continue;
    const value = params.get(key)!;
    if (!isInstant(value)) return { query, error: 'В ссылке указано неверное время начала или время без часового пояса.' };
    query[key] = value;
  }
  if (query.to && Date.parse(query.to) <= Date.parse(query.from!)) return { query, error: 'Верхняя граница времени должна быть позже нижней.' };
  for (const key of ['dateFrom', 'dateTo'] as const) {
    if (!params.has(key)) continue;
    const value = params.get(key)!;
    if (!isCalendarDate(value)) return { query, error: 'В ссылке указана несуществующая календарная дата.' };
    query[key] = value;
  }
  if (query.dateFrom && query.dateTo && query.dateTo <= query.dateFrom) return { query, error: 'Последний день диапазона должен быть не раньше первого.' };
  // A shareable catalog URL starts at the first page; only the API may issue cursors.
  return { query, error: null };
}

export function draftFromSearch(search: string): FilterDraft {
  const params = new URLSearchParams(search);
  const to = params.get('dateTo') ?? '';
  let lastDay = '';
  if (isCalendarDate(to)) { try { lastDay = adjacentDay(to, -1); } catch { /* Invalid lower boundary stays visible as a URL error. */ } }
  return { q: params.get('q') ?? '', city: params.get('city') ?? '', activityTypeId: params.get('activityTypeId') ?? '', joinMode: params.get('joinMode') ?? '', firstDay: params.get('dateFrom') ?? '', lastDay };
}

export function applyDraft(search: string, draft: FilterDraft, defaultFrom: string): string {
  const params = new URLSearchParams(search);
  for (const key of [...visibleKeys, 'cursor']) params.delete(key);
  for (const key of ['q', 'city', 'activityTypeId', 'joinMode'] as const) {
    const value = draft[key].trim();
    if (value) params.set(key, value);
  }
  if (draft.firstDay && !isCalendarDate(draft.firstDay) || draft.lastDay && !isCalendarDate(draft.lastDay)) throw new RangeError('Укажи существующие даты.');
  if (draft.firstDay && draft.lastDay && draft.lastDay < draft.firstDay) throw new RangeError('Последний день не может быть раньше первого.');
  if (draft.firstDay) params.set('dateFrom', draft.firstDay);
  if (draft.lastDay || draft.firstDay) params.set('dateTo', adjacentDay(draft.lastDay || draft.firstDay, 1));
  if (!params.has('from')) params.set('from', defaultFrom);
  const parsed = parseCatalogSearch(params.toString(), defaultFrom);
  if (parsed.error) throw new RangeError(parsed.error);
  return params.toString();
}
