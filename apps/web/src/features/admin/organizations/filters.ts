import type { components, operations } from '../../../shared/api/client';

export const approvalOptions: { value: components['schemas']['ApprovalState']; label: string }[] = [
  { value: 'NOT_SUBMITTED', label: 'Не отправлена' }, { value: 'PENDING', label: 'На проверке' },
  { value: 'APPROVED', label: 'Допущена' }, { value: 'REJECTED', label: 'Отказ' },
];
type Filters = Pick<NonNullable<operations['adminListOrganizations']['parameters']['query']>, 'q' | 'approvalState'>;
export function readFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const q = (params.get('q') ?? '').trim();
  const state = params.get('approvalState') ?? '';
  if (Array.from(q).length > 200) throw new Error('Поисковый запрос — не более 200 символов.');
  const approvalState = approvalOptions.find((option) => option.value === state)?.value;
  if (state && !approvalState) throw new Error('Неизвестное состояние допуска в ссылке. Сбрось фильтры.');
  return { ...(q && { q }), ...(approvalState && { approvalState }) };
}
export function filterSearch(q: string, approvalState: string) {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (approvalState) params.set('approvalState', approvalState);
  readFilters(params.toString());
  return params.size ? `?${params}` : '';
}
export function safeListSearch(search: string) {
  try { const filters = readFilters(search); return filterSearch(filters.q ?? '', filters.approvalState ?? ''); } catch { return ''; }
}
