import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sessionEpoch } from './session-boundary';
import { OperationFailure, operationFailure, requestSignal } from './operation';
import type { components } from './client';

export function confirmed<T>(result: { response: Response; data?: T; error?: components['schemas']['ErrorResponse'] }, valid: (data: T) => boolean) {
  if (result.response.status === 200 && result.data && valid(result.data)) return result.data;
  if (result.response.status >= 400 && result.response.status < 500) throw operationFailure(result);
  throw new OperationFailure(0, 'UNKNOWN_RESULT');
}
export function useAdminAction(reload: () => Promise<boolean>) {
  const [pending, setPending] = useState(false), [locked, setLocked] = useState(false), [notice, setNotice] = useState('');
  const lock = useRef(false), mounted = useRef(false), request = useRef<AbortController | null>(null);
  const client = useQueryClient();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  async function run(execute: (signal: AbortSignal) => Promise<unknown>, success: string) {
    if (lock.current || locked) return;
    lock.current = true; setPending(true); setNotice('');
    const epoch = sessionEpoch(), controller = new AbortController(); request.current = controller;
    try {
      await execute(requestSignal(controller.signal));
      if (!mounted.current || epoch !== sessionEpoch()) return;
      setNotice(success); setLocked(true);
      await client.invalidateQueries({ predicate: (query) => ['public', 'resource', 'private-events', 'personal-plans', 'participants', 'messages', 'admin-events', 'admin-messages', 'admin-types'].includes(String(query.queryKey[0])) });
      const ok = await reload();
      if (mounted.current && epoch === sessionEpoch()) setLocked(!ok);
    } catch (problem) {
      if (!mounted.current || epoch !== sessionEpoch() || controller.signal.aborted) return;
      const code = problem instanceof OperationFailure ? problem.code : 'UNKNOWN_RESULT';
      setLocked(code === 'UNKNOWN_RESULT' || ['MESSAGE_CHANGED', 'REPORTS_CHANGED', 'ACTIVITY_TYPE_CHANGED', 'DECISION_CONFLICT'].includes(code));
      setNotice(code === 'UNKNOWN_RESULT' ? 'Результат операции неизвестен. Сначала перечитай сведения; автоматического повтора нет.' : code === 'ACTIVITY_TYPE_NAME_CONFLICT' ? 'Это имя уже занято. Ввод сохранён, выбери другое имя.' : ['MESSAGE_CHANGED', 'REPORTS_CHANGED', 'ACTIVITY_TYPE_CHANGED', 'DECISION_CONFLICT'].includes(code) ? 'Сведения изменились. Перечитай текущую версию перед новым явным действием.' : 'Сервер не подтвердил действие. Ввод сохранён; проверь доступ и сведения.');
    } finally { lock.current = false; if (mounted.current && epoch === sessionEpoch()) setPending(false); }
  }
  async function check() {
    if (lock.current) return;
    lock.current = true; setPending(true); const epoch = sessionEpoch();
    try {
      const ok = await reload();
      if (mounted.current && epoch === sessionEpoch()) { setLocked(!ok); setNotice(ok ? 'Сведения перечитаны. Это текущее состояние, а не доказательство потерянного ответа. Новое действие требует отдельного нажатия.' : 'Не удалось перечитать сведения. Действия остаются заблокированными.'); }
    } finally { lock.current = false; if (mounted.current && epoch === sessionEpoch()) setPending(false); }
  }
  return { run, check, pending, locked, notice };
}
