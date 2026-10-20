import { api, type components } from '../../shared/api/client';
import { confirmed, useAdminAction } from '../../shared/api/admin-action';
import { sameId } from '../../shared/api/operation';
import { Button } from '../../shared/ui/Button';
import styles from '../admin/events/admin.module.css';
export function EventReports({ event, refreshing, reload }: { event: components['schemas']['AdminEvent']; refreshing: boolean; reload: () => Promise<boolean> }) {
  const action = useAdminAction(reload);
  async function dismiss() {
    if (refreshing || action.pending || action.locked || event.openEventReportsCount === 0) return;
    await action.run(async (signal) => confirmed(await api.POST('/admin/events/{eventId}/reports/dismiss', { params: { path: { eventId: event.id } }, body: { expectedReportsRevision: event.eventReportsRevision }, signal }), (row) => sameId(row.id, event.id) && row.openEventReportsCount === 0), 'Сервер подтвердил отклонение прямых жалоб на встречу.');
  }
  return <section className={styles.card}><h2>Жалобы</h2><p>На встречу: {event.openEventReportsCount} · На сообщения: {event.openMessageReportsCount}</p><p>Снятие публикации закрывает только прямые жалобы на встречу. Жалобы на сообщения рассматриваются отдельно.</p>
    {event.openEventReportsCount > 0 && <Button variant="secondary" disabled={refreshing || action.locked} pending={action.pending} onClick={() => void dismiss()}>Отклонить жалобы на встречу</Button>}
    {action.notice && <p role="status">{action.notice}</p>}{action.locked && <Button pending={action.pending} onClick={() => void action.check()}>Перечитать жалобы встречи</Button>}
  </section>;
}
