import { useEffect, useRef, useState } from 'react';
import type { components } from '../../shared/api/client';
import { useSession } from '../auth/SessionProvider';
import { Button } from '../../shared/ui/Button';
import { PrivateGate } from '../participation/user/PrivateGate';
import { sessionEpoch, reportSessionLoss } from '../../shared/api/session-boundary';
import styles from './media.module.css';

type AvatarState = components['schemas']['AvatarState'];
type AdminAvatar = components['schemas']['AdminAvatar'];
const labels: Record<string, string> = { EMPTY: 'Аватар не выбран', PENDING: 'На проверке — другим видна заглушка', APPROVED: 'Одобрен', HIDDEN: 'Скрыт — другим видна заглушка' };
async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const epoch = sessionEpoch();
  const response = await fetch('/api/v1' + url, { method, credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = response.status === 204 ? null : await response.json();
  if (response.status === 401) reportSessionLoss(epoch, 'expired');
  if (response.status === 403 && data?.error?.code === 'ACCOUNT_BLOCKED') reportSessionLoss(epoch, 'blocked');
  if (!response.ok) throw new Error(data?.error?.code === 'AVATAR_CHANGED' ? 'Версия изменилась. Обнови состояние перед новым действием.' : data?.error?.message || `Запрос отклонён (${response.status})`);
  return data as T;
}
async function svgFile(file: File): Promise<string> {
  if (file.size > 131072) throw new Error('SVG должен быть не больше 128 КиБ.');
  const svg = await file.text();
  if (!svg.trim() || new TextEncoder().encode(svg).length > 131072) throw new Error('Проверь размер и содержимое SVG.');
  return svg;
}
const safeImage = (url: string | null) => url && /^\/(api\/v1\/|assets\/avatars\/presets\/)/.test(url) ? url : undefined;

export function AvatarPanel() {
  const session = useSession();
  return session.me ? <AvatarEditor key={`${sessionEpoch()}:${session.me.account.id}`} /> : null;
}
function AvatarEditor() {
  const session = useSession(), epoch = sessionEpoch();
  const [state, setState] = useState<AvatarState | null>(null), [presets, setPresets] = useState<components['schemas']['AvatarPreset'][]>([]);
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [locked, setLocked] = useState(false);
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && epoch === sessionEpoch();
  async function load() {
    try { const [avatar, catalogue] = await Promise.all([request<AvatarState>('/me/avatar'), request<components['schemas']['AvatarPresetList']>('/avatar-presets')]); if (current()) { setState(avatar); setPresets(catalogue.items); setLocked(false); } }
    catch (e) { if (current()) { setState(null); setNotice(String((e as Error).message)); } }
  }
  useEffect(() => { void load(); }, []);
  async function change(action: () => Promise<AvatarState>) {
    if (lock.current || locked) return; lock.current = true; setBusy(true); setNotice('');
    try { const avatar = await action(); if (current()) { setState(avatar); setNotice('Изменение подтверждено сервером.'); void session.refresh(); } }
    catch (e) { if (current()) { setLocked(true); setNotice((e as Error).message + ' Результат не подтверждён; обнови состояние. Запрос не повторяется автоматически.'); } }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  return <section className={styles.card} aria-label="Настройка аватара"><h2>Твой аватар</h2>
    {notice && <p role="status">{notice}</p>}
    {state && <><p>{labels[state.status]}</p>{safeImage(state.previewUrl) && <img className={styles.avatar} src={safeImage(state.previewUrl)} alt="Предпросмотр своего аватара" />}
      <fieldset disabled={busy || locked}><legend>Готовые аватары</legend><div className={styles.presets}>{presets.map(p => <button key={p.id} className={styles.preset} type="button" aria-label={`Выбрать ${p.label}`} onClick={() => void change(() => request('/me/avatar/preset', 'PUT', { presetId: p.id, expectedRevision: state.revision }))}><img src={safeImage(p.imageUrl)} alt="" /><span>{p.label}</span></button>)}</div>
      <label>Загрузить свой SVG (до 128 КиБ)<input type="file" accept=".svg,image/svg+xml" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void change(async () => request('/me/avatar', 'PUT', { svg: await svgFile(file), expectedRevision: state.revision })); }} /></label>
      <p>До одобрения администратором другим пользователям видна заглушка. Новая загрузка заменяет предыдущую.</p>
      <Button variant="secondary" onClick={() => void change(() => request('/me/avatar', 'DELETE', { expectedRevision: state.revision }))}>Убрать аватар</Button></fieldset></>}
    <Button variant="quiet" disabled={busy} onClick={() => void load()}>Обновить состояние аватара</Button>
  </section>;
}

export function CoverPanel({ eventId, refresh }: { eventId: string; refresh: () => void }) {
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [locked, setLocked] = useState(false);
  const lock = useRef(false), epoch = sessionEpoch();
  async function change(file?: File) {
    if (lock.current || locked) return; lock.current = true; setBusy(true); setNotice('');
    try { await request(`/events/${eventId}/cover`, file ? 'PUT' : 'DELETE', file ? { svg: await svgFile(file) } : undefined); if (epoch === sessionEpoch()) { setNotice('Фон сохранён сервером.'); refresh(); } }
    catch (e) { if (epoch === sessionEpoch()) { setLocked(true); setNotice((e as Error).message + ' Проверь актуальную встречу перед новым действием.'); } }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className={styles.card}><h2>Фон встречи</h2><p>SVG до 128 КиБ. Видим всем читателям встречи после серверной проверки.</p>{notice && <p role="status">{notice}</p>}<fieldset disabled={busy || locked}><label>Загрузить фон SVG<input type="file" accept=".svg,image/svg+xml" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void change(file); }} /></label><Button variant="secondary" onClick={() => void change()}>Убрать фон</Button></fieldset><Button variant="quiet" disabled={busy} onClick={() => { refresh(); setNotice('Для повторного изменения проверь обновлённую карточку.'); setLocked(false); }}>Обновить встречу</Button></section>;
}

export function AvatarModerationPage() {
  const session = useSession();
  return <PrivateGate>{session.me?.systemRole === 'ADMIN' ? <AvatarModeration key={sessionEpoch()} /> : <h1>Нет доступа к модерации</h1>}</PrivateGate>;
}
function AvatarModeration() {
  const [items, setItems] = useState<AdminAvatar[]>([]), [selected, setSelected] = useState<AdminAvatar | null>(null);
  const [status, setStatus] = useState('PENDING'), [q, setQ] = useState(''), [cursor, setCursor] = useState<string | null>(null);
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [previewReady, setPreviewReady] = useState(false);
  const lock = useRef(false), epoch = sessionEpoch(), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && epoch === sessionEpoch();
  async function load(next?: string) {
    try { const params = new URLSearchParams({ limit: '20', ...(status ? {status} : {}), ...(q.trim() ? {q:q.trim()} : {}), ...(next ? {cursor:next} : {}) }); const page = await request<components['schemas']['AdminAvatarPage']>('/admin/avatars?' + params); if (current()) { setItems(previous => next ? [...new Map([...previous, ...page.items].map(x => [x.account.id,x])).values()] : page.items); setCursor(page.nextCursor); } }
    catch (e) { if (current()) { setItems([]); setCursor(null); setSelected(null); setNotice((e as Error).message); } }
  }
  async function select(id: string) { setSelected(null); setPreviewReady(false); try { const avatar = await request<AdminAvatar>(`/admin/accounts/${id}/avatar`); if (current()) { setSelected(avatar); setLocked(false); } } catch(e) { if(current()) setNotice((e as Error).message); } }
  useEffect(() => { void load(); }, []);
  async function decide(decision: 'APPROVE' | 'HIDE') {
    if (!selected || lock.current || locked || !previewReady) return; lock.current = true; setBusy(true);
    try { const avatar = await request<AdminAvatar>(`/admin/accounts/${selected.account.id}/avatar/moderation`, 'POST', { decision, expectedRevision: selected.revision }); if (current()) { setSelected(avatar); setPreviewReady(false); setNotice('Решение подтверждено сервером.'); void load(); } }
    catch(e) { if(current()) { setLocked(true); setNotice((e as Error).message + ' Сначала перечитай выбранную версию; автоматического повтора нет.'); } }
    finally { lock.current = false; if(current()) setBusy(false); }
  }
  return <div className={styles.card}><h1>Модерация аватаров</h1>{notice && <p role="status">{notice}</p>}<form onSubmit={e => {e.preventDefault();setSelected(null);void load();}}><label>Поиск пользователя<input value={q} maxLength={200} onChange={e=>setQ(e.target.value)} /></label><label>Статус<select value={status} onChange={e=>{setStatus(e.target.value);setSelected(null);setItems([]);setCursor(null);}}><option value="PENDING">На проверке</option><option value="APPROVED">Одобрены</option><option value="HIDDEN">Скрыты</option><option value="">Все</option></select></label><Button type="submit">Найти аватары</Button></form>
    {items.map(item=><article key={item.account.id}><p>{item.account.displayName} · {labels[item.status]}</p><Button variant="secondary" onClick={()=>void select(item.account.id)}>Рассмотреть аватар {item.account.displayName}</Button></article>)}
    {!items.length && <p>В этом списке нет аватаров. Готовые варианты не требуют модерации.</p>}{cursor&&<Button onClick={()=>void load(cursor)}>Показать ещё аватары</Button>}
    {selected&&<section className={styles.card} aria-label="Выбранный аватар"><h2>{selected.account.displayName}</h2><p>{labels[selected.status]} · Версия {selected.revision}</p>{safeImage(selected.previewUrl)&&<img className={styles.avatar} src={safeImage(selected.previewUrl)} alt="Аватар для модерации" onLoad={()=>setPreviewReady(true)} onError={()=>{setLocked(true);setPreviewReady(false);}} />}<Button disabled={busy||locked||!previewReady||selected.status==='APPROVED'} onClick={()=>void decide('APPROVE')}>Одобрить аватар</Button><Button disabled={busy||locked||!previewReady||selected.status==='HIDDEN'} variant="danger" onClick={()=>void decide('HIDE')}>Скрыть аватар</Button><Button disabled={busy} variant="quiet" onClick={()=>void select(selected.account.id)}>Перечитать выбранный аватар</Button></section>}
  </div>;
}
