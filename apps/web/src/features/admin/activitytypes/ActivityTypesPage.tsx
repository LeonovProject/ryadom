import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type components } from '../../../shared/api/client';
import { operationFailure, requestSignal, sameId } from '../../../shared/api/operation';
import { confirmed, useAdminAction } from '../../../shared/api/admin-action';
import { useResourceQuery } from '../../../shared/api/resource-query';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { Button } from '../../../shared/ui/Button';
import { TextField, TextAreaField } from '../../../shared/ui/Field';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { useRefreshToken } from '../../participation/user/queries';
import { AdminBoundary } from '../events/AdminBoundary';
import styles from '../events/admin.module.css';
type Activity = components['schemas']['AdminActivityType'];
const labels = { PENDING: 'На проверке', APPROVED: 'В общем списке', REJECTED: 'Не включено в общий список' };
async function readActivity(id: string, signal: AbortSignal) { const result = await api.GET('/admin/activity-types/{activityTypeId}', { params: { path: { activityTypeId: id } }, signal, cache: 'no-store' }); if (result.response.status !== 200 || !result.data || !sameId(result.data.id, id)) throw operationFailure(result); return result.data; }
export function ActivityTypesPage() { return <AdminBoundary title="Спортивные направления"><Activities /></AdminBoundary>; }
function Activities() {
  const [params, setParams] = useSearchParams(), [q, setQ] = useState(params.get('q') ?? '');
  const status = params.get('catalogStatus') ?? 'PENDING', selected = params.get('id');
  const { token, refresh } = useRefreshToken();
  const valid = ['', 'PENDING', 'APPROVED', 'REJECTED'].includes(status) && [...(params.get('q') ?? '')].length <= 200;
  const feed = useInfiniteQuery({ queryKey: ['admin-types', sessionEpoch(), params.get('q'), status, token], enabled: valid, initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => { const result = await api.GET('/admin/activity-types', { params: { query: { q: params.get('q')?.trim() || undefined, catalogStatus: status as Activity['catalogStatus'] || undefined, limit: 20, cursor: pageParam } }, signal: requestSignal(signal), cache: 'no-store' }); if (result.response.status !== 200 || !result.data) throw operationFailure(result); return result.data; },
    getNextPageParam: (last, _pages, previous, all) => last.nextCursor && last.nextCursor !== previous && !all.includes(last.nextCursor) ? last.nextCursor : undefined, gcTime: 0, refetchOnWindowFocus: false });
  function set(key: string, value: string) { const next = new URLSearchParams(params); next.delete('cursor'); if (value || key === 'catalogStatus') next.set(key, value); else next.delete(key); setParams(next); }
  const items = [...new Map((feed.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.id, item])).values()];
  return <div className={styles.page}><PageTitle title="Спортивные направления" /><p>Включение направления в справочник не меняет публикацию встречи. Отклонённое направление можно использовать во встречах.</p>
    <form className={styles.row} onSubmit={(e) => { e.preventDefault(); set('q', q.trim()); }}><TextField label="Поиск направлений" value={q} onChange={(e) => setQ(e.target.value)} /><label className={styles.select}>Статус направления<select value={status} onChange={(e) => set('catalogStatus', e.target.value)}><option value="">Все</option><option value="PENDING">На проверке</option><option value="APPROVED">В общем списке</option><option value="REJECTED">Отклонены</option></select></label><Button type="submit">Найти направления</Button></form>
    <Button variant="quiet" onClick={refresh}>Обновить направления</Button>
    {!valid ? <StatePanel kind="error" title="Проверь фильтры направлений">Неизвестный статус или слишком длинный поиск.</StatePanel> : feed.isError && !feed.isFetchNextPageError ? <StatePanel kind="error" title="Направления не загрузились" action={<Button onClick={refresh}>Перечитать направления</Button>}>Список скрыт до успешного чтения.</StatePanel> : feed.isPending ? <StatePanel kind="loading" title="Загружаем направления" /> : <>
      {!items.length && <p>По этим условиям направлений нет.</p>}
      {items.map((item) => <article className={styles.card} key={item.id}><h2><Link to={`?${new URLSearchParams({ ...Object.fromEntries(params), id: item.id })}`}>{item.name}</Link></h2><p>{labels[item.catalogStatus]} · Связанных встреч: {item.eventCount}</p></article>)}
      {feed.isFetchNextPageError ? <Button onClick={refresh}>Читать список заново</Button> : feed.hasNextPage && <Button pending={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>Ещё направления</Button>}
    </>}
    {selected && <ActivityEditor key={`${sessionEpoch()}:${selected}`} id={selected} />}
  </div>;
}
function ActivityEditor({ id }: { id: string }) {
  const resource = useResourceQuery('admin-type', id, readActivity);
  const item = !resource.isError ? resource.data : undefined;
  const [name, setName] = useState<string | null>(null), [reason, setReason] = useState(''), [error, setError] = useState('');
  const action = useAdminAction(async () => !(await resource.refetch()).isError);
  const disabled = resource.isFetching || action.pending || action.locked;
  async function send(kind: 'APPROVE' | 'REJECT' | 'RENAME') {
    if (!item || disabled || kind !== 'RENAME' && !item.canDecide) return;
    const newName = (name ?? item.name).normalize('NFC').trim().replace(/\s+/gu, ' ');
    if (kind !== 'REJECT' && (!newName || [...newName].length > 100) || kind === 'REJECT' && (!reason.trim() || [...reason.trim()].length > 2000)) { setError('Имя — от 1 до 100 символов; причина отказа — от 1 до 2000.'); return; }
    setError('');
    await action.run(async (signal) => {
      if (kind === 'RENAME') return confirmed(await api.PATCH('/admin/activity-types/{activityTypeId}', { params: { path: { activityTypeId: id } }, body: { name: newName, expectedName: item.name }, signal }), (row) => sameId(row.id, id) && row.name === newName);
      const body: components['schemas']['ActivityTypeDecisionInput'] = kind === 'REJECT' ? { decision: 'REJECT', expectedName: item.name, reason: reason.trim() } : { decision: 'APPROVE', expectedName: item.name, ...(newName !== item.name ? { name: newName } : {}) };
      return confirmed(await api.POST('/admin/activity-types/{activityTypeId}/decision', { params: { path: { activityTypeId: id } }, body, signal }), (row) => sameId(row.id, id) && row.catalogStatus === (kind === 'APPROVE' ? 'APPROVED' : 'REJECTED'));
    }, 'Сервер подтвердил изменение направления.');
  }
  return <section className={styles.card} aria-label="Проверка направления"><h2>Проверка направления</h2>
    {!item ? <StatePanel kind={resource.isError ? 'error' : 'loading'} title={resource.isError ? 'Направление недоступно' : 'Открываем направление'} action={<Button onClick={() => void resource.refetch()}>Перечитать направление</Button>}>Проверь доступ и ссылку.</StatePanel> : <>
      <h3>{item.name}</h3><p>{labels[item.catalogStatus]}</p>{item.createdBy ? <Link to={`/people/${item.createdBy.id}`}>Предложил: {item.createdBy.displayName}</Link> : <p>Подготовленное направление</p>}
      {item.reviewedBy && <Link to={`/people/${item.reviewedBy.id}`}>Решение: {item.reviewedBy.displayName}</Link>}{item.reviewedAt && <time dateTime={item.reviewedAt}>{item.reviewedAt}</time>}{item.rejectionReason && <p className={styles.text}>Причина отказа: {item.rejectionReason}</p>}
      <Link to={`/admin/events?activityTypeId=${id}`}>Связанные встречи: {item.eventCount}</Link>
      <TextField label="Имя направления" value={name ?? item.name} onChange={(e) => setName(e.target.value)} disabled={disabled} />
      {item.canDecide && <TextAreaField label="Причина отказа направлению" value={reason} onChange={(e) => setReason(e.target.value)} disabled={disabled} />}
      {error && <p role="alert">{error}</p>}
      <div className={styles.row}>{item.canDecide && <><Button disabled={disabled} onClick={() => void send('APPROVE')}>Одобрить направление</Button><Button variant="secondary" disabled={disabled} onClick={() => void send('REJECT')}>Отказать направлению</Button></>}<Button variant="secondary" disabled={disabled} onClick={() => void send('RENAME')}>Исправить имя</Button></div>
      {action.notice && <p role="status" className={styles.notice}>{action.notice}</p>}<Button variant="quiet" pending={action.pending} onClick={() => void action.check()}>Перечитать текущее направление</Button>
    </>}
  </section>;
}
