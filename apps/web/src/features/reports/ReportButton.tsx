import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, type components } from '../../shared/api/client';
import { OperationFailure, operationFailure, sameId, uuid } from '../../shared/api/operation';
import { sessionEpoch } from '../../shared/api/session-boundary';
import { useSession } from '../auth/SessionProvider';
import { authLink } from '../auth/return-to';
import { Button, ButtonLink } from '../../shared/ui/Button';
export function ReportButton({ type, id, own = false }: { type: 'EVENT' | 'MESSAGE'; id: string; own?: boolean }) {
  const session = useSession(), location = useLocation(), epoch = sessionEpoch();
  return <ReportControl key={`${epoch}:${type}:${id}`} type={type} id={id} own={own} returnTo={location.pathname} loggedIn={!!session.me && !session.logoutPending} loading={session.status === 'loading' || session.status === 'error'} />;
}
function ReportControl({ type, id, own, returnTo, loggedIn, loading }: { type: 'EVENT' | 'MESSAGE'; id: string; own: boolean; returnTo: string; loggedIn: boolean; loading: boolean }) {
  const [pending, setPending] = useState(false), [receipt, setReceipt] = useState<components['schemas']['Report']>(), [notice, setNotice] = useState('');
  const lock = useRef(false), mounted = useRef(false), request = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  async function send() {
    if (lock.current || !loggedIn || own || receipt) return;
    lock.current = true; setPending(true); setNotice(''); const epoch = sessionEpoch();
    const controller = new AbortController(); request.current = controller;
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
      const result = type === 'EVENT' ? await api.POST('/events/{eventId}/reports', { params: { path: { eventId: id } }, signal }) : await api.POST('/messages/{messageId}/reports', { params: { path: { messageId: id } }, signal });
      if (!mounted.current || epoch !== sessionEpoch()) return;
      const data = result.data;
      if (![200, 201].includes(result.response.status) || !data || !uuid(data.id) || data.target.type !== type || !sameId(data.target.id, id) || !['OPEN', 'RESOLVED', 'DISMISSED'].includes(data.status)) { if (result.response.status >= 400 && result.response.status < 500) throw operationFailure(result); throw new Error('Unknown result'); }
      setReceipt(data); setNotice(data.status === 'OPEN' ? result.response.status === 201 ? 'Жалоба сохранена. Контент не скрывается автоматически.' : 'Жалоба уже была отправлена и ожидает рассмотрения.' : data.status === 'RESOLVED' ? 'Эта жалоба уже рассмотрена. Повтор не открывает её заново.' : 'Эта жалоба уже отклонена. Повтор не открывает её заново.');
    } catch (problem) {
      if (mounted.current && epoch === sessionEpoch() && !controller.signal.aborted) setNotice(problem instanceof OperationFailure ? 'Жалоба не принята. Проверь доступность контента и текущий вход.' : 'Сервер не подтвердил жалобу. Автоматического повтора нет. Можно явно повторить эту же жалобу: существующая запись не создастся второй раз.');
    } finally { lock.current = false; if (mounted.current && epoch === sessionEpoch()) setPending(false); }
  }
  if (own || loading) return null;
  return <div>{!loggedIn ? <ButtonLink to={authLink('/login', returnTo)} variant="quiet">Войти для жалобы{type === 'MESSAGE' ? ' на сообщение' : ' на встречу'}</ButtonLink> : !receipt && <Button variant="quiet" pending={pending} onClick={() => void send()}>Пожаловаться{type === 'MESSAGE' ? ' на сообщение' : ' на встречу'}</Button>}{notice && <p role="status">{notice}</p>}</div>;
}
