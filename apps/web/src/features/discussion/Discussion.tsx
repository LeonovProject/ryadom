import { ReportButton } from '../reports/ReportButton';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useBeforeUnload, useBlocker, useLocation } from 'react-router-dom';
import { api, type components } from '../../shared/api/client';
import { OperationFailure, operationFailure, requestSignal, sameId, uuid } from '../../shared/api/operation';
import { sessionEpoch } from '../../shared/api/session-boundary';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { StatePanel } from '../../shared/ui/StatePanel';
import { TextAreaField } from '../../shared/ui/Field';
import { Avatar } from '../../shared/ui/Avatar';
import { FormLeavePrompt } from '../../shared/ui/FormLeavePrompt';
import { useSession } from '../auth/SessionProvider';
import { authLink } from '../auth/return-to';
import { useRefreshToken } from '../participation/user/queries';
import { clearMessageDraft, readMessageDraft, saveMessageDraft } from './draft';
import { orderedMessages } from './messages';
import styles from './discussion.module.css';

type Event = components['schemas']['PublishedEventDetail'];
export function Discussion({ event, refreshingEvent }: { event: Event; refreshingEvent: boolean }) {
  const { token, refresh } = useRefreshToken();
  const session = useSession();
  const list = useRef<HTMLOListElement>(null);
  const anchor = useRef<{ element: HTMLElement; top: number; focus: Element | null } | null>(null);
  const feed = useInfiniteQuery({
    queryKey: ['messages', sessionEpoch(), event.id, token], initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const result = await api.GET('/events/{eventId}/messages', { params: { path: { eventId: event.id }, query: { order: 'NEWEST_FIRST', limit: 20, cursor: pageParam } }, signal: requestSignal(signal), cache: 'no-store' });
      if (result.response.status !== 200 || !result.data) throw operationFailure(result);
      if (result.data.items.some((item) => !sameId(item.eventId, event.id)) || new Set(result.data.items.map((item) => item.id.toLowerCase())).size !== result.data.items.length || pageParam && result.data.nextCursor === pageParam) throw new OperationFailure(502);
      return result.data;
    },
    getNextPageParam: (last, _pages, previous, params) => last.nextCursor && last.nextCursor !== previous && !params.includes(last.nextCursor) ? last.nextCursor : undefined,
    gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false,
  });
  useLayoutEffect(() => {
    if (feed.isFetchingNextPage || !anchor.current) return;
    const saved = anchor.current; anchor.current = null;
    if (!saved.element.isConnected || feed.isError || document.activeElement !== saved.focus && document.activeElement !== document.body) return;
    window.scrollBy({ top: saved.element.getBoundingClientRect().top - saved.top, behavior: 'auto' });
    if (document.activeElement === document.body) saved.element.focus({ preventScroll: true });
  }, [feed.isFetchingNextPage, feed.dataUpdatedAt, feed.isError]);
  const messages = orderedMessages(feed.data?.pages ?? []);
  return <section id="discussion" className={styles.section} aria-label="Обсуждение встречи">
    <div className={styles.row}><h2>Вопросы и ответы</h2><Button variant="quiet" pending={feed.isFetching && !feed.isFetchingNextPage} onClick={refresh}>Обновить обсуждение</Button></div>
    <p className={styles.muted}>Можно уточнить условия до записи. После обновления показываем последние сообщения; ранние загружаются сверху.</p>
    {!feed.data && feed.isPending ? <StatePanel kind="loading" title="Загружаем обсуждение" /> : feed.isError && !feed.isFetchNextPageError ? <StatePanel kind="error" title="Обсуждение сейчас недоступно" action={<Button onClick={refresh}>Повторить загрузку обсуждения</Button>}>Сообщения скрыты до успешного чтения.</StatePanel> : <>
      {feed.hasNextPage && !feed.isError && <Button variant="secondary" pending={feed.isFetchingNextPage} onClick={() => {
        const element = list.current?.querySelector<HTMLElement>('[data-message-id]');
        if (element) anchor.current = { element, top: element.getBoundingClientRect().top, focus: document.activeElement };
        void feed.fetchNextPage();
      }}>Ранние сообщения</Button>}
      {feed.isFetchNextPageError && <StatePanel kind="error" title="Ранние сообщения не загрузились" action={<Button onClick={refresh}>Читать обсуждение заново</Button>}>Уже загруженные сообщения сохранены. Между ними нет пропущенных страниц.</StatePanel>}
      {!messages.length && <p>Пока нет сообщений. Можно задать первый вопрос.</p>}
      <ol ref={list} className={styles.list}>{messages.map((message) => <li key={message.id} data-message-id={message.id.toLowerCase()} tabIndex={-1} className={styles.message}>
        <div className={styles.row}><Avatar name={message.author.displayName} url={message.author.avatarUrl} /><Link to={`/people/${message.author.id}`}>{message.author.displayName}</Link>{message.authorIsOrganizer && <strong className={styles.organizer}>Организатор</strong>}</div>
        <time dateTime={message.createdAt}>{new Intl.DateTimeFormat('ru-RU', { timeZone: event.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(message.createdAt))} · {event.timezone}</time>
        {message.status === 'VISIBLE' ? <><p className={styles.body}>{message.body}</p><ReportButton type="MESSAGE" id={message.id} own={session.me?.account.id.toLowerCase() === message.author.id.toLowerCase()} /></> : <p className={styles.muted}>Сообщение скрыто модератором.</p>}
      </li>)}</ol>
    </>}
    <MessageForm key={`${sessionEpoch()}:${event.id}`} event={event} refresh={refresh} disabled={refreshingEvent || feed.isPending || feed.isError} />
  </section>;
}
function MessageForm({ event, refresh, disabled }: { event: Event; refresh: () => void; disabled: boolean }) {
  const session = useSession(), location = useLocation();
  const ownerId = session.me?.account.id ?? null;
  const [draft] = useState(() => readMessageDraft(event.id, ownerId));
  const [body, setBody] = useState(draft.body), [uncertain, setUncertain] = useState(draft.uncertain), [pending, setPending] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lock = useRef(false), mounted = useRef(false), request = useRef<AbortController | null>(null);
  const fieldId = `message-${event.id}`;
  const blocker = useBlocker(({ nextLocation }) => !!body && nextLocation.pathname !== '/login' && nextLocation.pathname !== '/register');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { saveMessageDraft({ eventId: event.id, ownerId, body, uncertain }); }, [event.id, ownerId, body, uncertain]);
  useBeforeUnload((e) => { if (body || lock.current) { e.preventDefault(); e.returnValue = ''; } });
  const epoch = sessionEpoch();
  async function send(e: FormEvent) {
    e.preventDefault();
    if (lock.current || uncertain || disabled || !session.me || !event.capabilities.canPostMessage) return;
    if (!body.trim() || [...body.trim()].length > 4000) { setError('Введи сообщение от 1 до 4000 символов.'); document.getElementById(fieldId)?.focus(); return; }
    lock.current = true; setPending(true); setError(''); setNotice('');
    saveMessageDraft({ eventId: event.id, ownerId, body, uncertain: true });
    const controller = new AbortController(); request.current = controller;
    try {
      const result = await api.POST('/events/{eventId}/messages', { params: { path: { eventId: event.id } }, body: { body: body.trim() }, signal: requestSignal(controller.signal) });
      if (!mounted.current || epoch !== sessionEpoch()) return;
      const message = result.data;
      if (result.response.status !== 201 || !message || !uuid(message.id) || !sameId(message.eventId, event.id) || !sameId(message.author.id, session.me.account.id) || message.status !== 'VISIBLE') {
        if (result.response.status >= 400 && result.response.status < 500) throw operationFailure(result);
        throw new OperationFailure(0, 'UNKNOWN_RESULT');
      }
      clearMessageDraft(); setBody(''); setUncertain(false); setNotice('Сообщение сохранено сервером.'); refresh();
    } catch (problem) {
      if (!mounted.current || epoch !== sessionEpoch() || controller.signal.aborted) return;
      const code = problem instanceof OperationFailure ? problem.code : 'UNKNOWN_RESULT';
      const unknown = code === 'UNKNOWN_RESULT'; setUncertain(unknown);
      saveMessageDraft({ eventId: event.id, ownerId, body, uncertain: unknown });
      setNotice(unknown ? 'Результат отправки неизвестен. Текст сохранён в памяти вкладки. Повторная отправка заблокирована; обнови обсуждение и проверь сообщения. Совпадение текста не доказывает результат этого запроса.' : code === 'EVENT_UNAVAILABLE' || code === 'NOT_FOUND' ? 'Встреча недоступна. Сообщение не подтверждено.' : 'Не удалось отправить сообщение. Проверь текст и текущий доступ.');
      if (code === 'EVENT_UNAVAILABLE' || code === 'NOT_FOUND') refresh();
    } finally { lock.current = false; if (mounted.current && epoch === sessionEpoch()) setPending(false); }
  }
  return <>
    <form className={styles.form} onSubmit={send} noValidate aria-label="Вопрос организатору" aria-busy={pending}>
      <TextAreaField id={fieldId} label="Твой вопрос или ответ" value={body} error={error} disabled={pending || uncertain || session.logoutPending} onChange={(e) => { setBody(e.target.value); setError(''); }} hint="Обычный текст, до 4000 символов. Черновик только в памяти вкладки; перезагрузка удалит его." />
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {!session.me ? <ButtonLink to={authLink('/login', location.pathname)}>Войти и вернуться к вопросу</ButtonLink> : event.capabilities.canPostMessage ? <Button type="submit" pending={pending} disabled={uncertain || disabled || session.logoutPending}>Отправить сообщение</Button> : <p>Отправка сейчас недоступна. Проверь текущий вход и обнови сведения встречи.</p>}
      {uncertain && <Button variant="secondary" onClick={refresh}>Проверить последние сообщения</Button>}
    </form>
    <FormLeavePrompt open={blocker.state === 'blocked'} description={pending || uncertain ? 'Сообщение могло сохраниться. Уход не отменяет запрос; автоматического повтора не будет.' : 'Текст хранится только в памяти вкладки. При уходе из формы он будет удалён.'} stay={() => { if (blocker.state === 'blocked') blocker.reset(); }} leave={() => { clearMessageDraft(); if (blocker.state === 'blocked') blocker.proceed(); }} />
  </>;
}
