import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, type components } from '../../../shared/api/client';
import { OperationFailure, operationFailure, requestSignal, sameId, uuid } from '../../../shared/api/operation';
import { refreshEventData } from '../../../shared/api/event-cache';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { Button, ButtonLink } from '../../../shared/ui/Button';
import { useSession } from '../../auth/SessionProvider';
import { authLink } from '../../auth/return-to';
import styles from './participation.module.css';

type Event = components['schemas']['PublishedEventDetail'];
export function JoinControl({ event, refreshing }: { event: Event; refreshing: boolean }) {
  const session = useSession(), location = useLocation(), client = useQueryClient();
  const [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState('');
  const lock = useRef(false), mounted = useRef(false), request = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const epoch = sessionEpoch();
  const me = session.me;
  async function reread() {
    if (lock.current) return;
    lock.current = true; setPending(true);
    try {
      // No replay. Existing participation is learned from the canonical detail.
      const result = await api.GET('/events/{eventId}', { params: { path: { eventId: event.id } }, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
      if (result.response.status !== 200 || !result.data || !sameId(result.data.id, event.id)) throw operationFailure(result);
      await refreshEventData(client, event.id);
      if (mounted.current && epoch === sessionEpoch()) { setUncertain(false); setNotice('Сведения перечитаны. Проверь текущую запись; её наличие не подтверждает потерянный ответ.'); }
    } catch { if (mounted.current && epoch === sessionEpoch()) setNotice('Не удалось проверить запись. Повторная отправка остаётся заблокированной.'); }
    finally { lock.current = false; if (mounted.current) setPending(false); }
  }
  async function join() {
    if (lock.current || uncertain || refreshing || !me || !event.capabilities.canJoin) return;
    lock.current = true; setPending(true); setNotice('');
    const controller = new AbortController(); request.current = controller;
    try {
      const result = await api.POST('/events/{eventId}/participations', { params: { path: { eventId: event.id } }, signal: requestSignal(controller.signal) });
      if (epoch !== sessionEpoch() || !mounted.current) return;
      const p = result.data;
      if (![200, 201].includes(result.response.status) || !p || !uuid(p.id) || !sameId(p.eventId, event.id) || !sameId(p.accountId, me.account.id) || !['PENDING', 'CONFIRMED', 'REJECTED'].includes(p.status)) {
        if (result.response.status >= 400 && result.response.status < 500) throw operationFailure(result);
        throw new OperationFailure(0, 'UNKNOWN_RESULT');
      }
      setNotice(result.response.status === 200 ? 'У тебя уже есть запись на эту встречу. Её статус сохранён.' : p.status === 'CONFIRMED' ? 'Запись подтверждена сервером.' : p.status === 'PENDING' ? 'Заявка отправлена. Дождись решения организатора.' : 'Сервер вернул существующий отказ. Статус записи сохранён.');
      await refreshEventData(client, event.id);
    } catch (error) {
      if (epoch !== sessionEpoch() || !mounted.current || controller.signal.aborted) return;
      const code = error instanceof OperationFailure ? error.code : 'UNKNOWN_RESULT';
      setUncertain(code === 'UNKNOWN_RESULT');
      setNotice(code === 'UNKNOWN_RESULT' ? 'Результат записи неизвестен. Перед новой попыткой перечитай сведения. Запрос автоматически не повторяется.'
        : code === 'EVENT_STARTED' ? 'Встреча уже началась. Новая запись закрыта.'
          : code === 'EVENT_UNAVAILABLE' || code === 'NOT_FOUND' ? 'Встреча сейчас недоступна для записи.'
            : code === 'ALREADY_ORGANIZER' ? 'Ты организатор этой встречи, отдельная запись не нужна.' : 'Не удалось записаться. Проверь текущие сведения перед новой попыткой.');
      if (code !== 'UNKNOWN_RESULT') await refreshEventData(client, event.id);
    } finally { lock.current = false; if (mounted.current && epoch === sessionEpoch()) setPending(false); }
  }
  const canOfferLogin = !me && session.status !== 'loading' && session.status !== 'error' && event.capabilities.joinBlockedReason !== 'EVENT_STARTED';
  return <div className={styles.stack}>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {session.status === 'error' && <p>Проверь текущий вход перед записью.</p>}
    {canOfferLogin && <ButtonLink to={authLink('/login', location.pathname + location.search)}>Войти для записи</ButtonLink>}
    {uncertain ? <Button pending={pending} onClick={() => void reread()}>Проверить текущую запись</Button>
      : me && !event.myParticipation && event.capabilities.canJoin && <Button pending={pending} disabled={refreshing || session.logoutPending} onClick={() => void join()}>{pending ? 'Отправляем…' : event.joinMode === 'OPEN' ? 'Присоединиться' : 'Подать заявку'}</Button>}
    {me && event.capabilities.joinBlockedReason === 'ALREADY_ORGANIZER' && <p>Ты организуешь эту встречу. Отдельная запись не нужна.</p>}
    {event.myParticipation?.status === 'REJECTED' && <p>Заявка отклонена. Повторная подача не предусмотрена.</p>}
    {event.myParticipation?.status === 'PENDING' && <p>До решения организатора ты не входишь в подтверждённый состав.</p>}
  </div>;
}
