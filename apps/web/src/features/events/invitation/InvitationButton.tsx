import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../../../shared/ui/Button';
import { createInvitationQr } from '../../../shared/qr';
import { ResourceFailure } from '../../../shared/api/resource-query';
import { readEvent } from '../detail/api';
import { invitationData, type InvitationData } from './data';
import { InvitationSheet } from './InvitationSheet';
import styles from './invitation.module.css';

type Preview = { data: InvitationData; qr: string };
async function resources(element: HTMLElement | null) {
  if (!element) throw new Error('Лист приглашения недоступен.');
  await Promise.race([
    Promise.all([
      document.fonts.load('400 14pt "Open Sans"'), document.fonts.load('700 24pt Montserrat'),
      ...Array.from(element.querySelectorAll('img'), (image) => image.decode()),
    ]),
    new Promise((_, reject) => window.setTimeout(() => reject(new Error('Не удалось загрузить ресурсы приглашения.')), 12_000)),
  ]);
  if (!document.fonts.check('400 14pt "Open Sans"') || !document.fonts.check('700 24pt Montserrat')) throw new Error('Не удалось загрузить шрифты приглашения.');
}
function failureMessage(error: unknown) {
  if (error instanceof ResourceFailure) return error.status === 404 ? 'Встреча больше недоступна. Приглашение не подготовлено.' : 'Не удалось прочитать актуальную встречу. Попробуй ещё раз.';
  return error instanceof Error && /^[А-ЯЁ]/u.test(error.message) ? error.message : 'Не удалось подготовить приглашение. Попробуй ещё раз.';
}
export function InvitationButton({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const sheet = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    document.body.dataset.invitationActive = 'true';
    let scroll: { x: number; y: number; dialog: number } | undefined;
    const before = () => {
      scroll = { x: window.scrollX, y: window.scrollY, dialog: dialog.current?.scrollTop ?? 0 };
      window.scrollTo(0, 0);
      if (dialog.current) dialog.current.scrollTop = 0;
    };
    const after = () => {
      if (scroll) { window.scrollTo(scroll.x, scroll.y); if (dialog.current) dialog.current.scrollTop = scroll.dialog; }
    };
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after);
    return () => { delete document.body.dataset.invitationActive; window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };

  }, [open]);
  useEffect(() => {
    if (!preview) return;
    let active = true;
    void resources(sheet.current).then(() => { if (active) setReady(true); }).catch((problem) => {
      if (active) { setReady(false); setError(failureMessage(problem)); }
    });
    return () => { active = false; };
  }, [preview]);

  async function prepare(print = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setReady(false); setError(''); setNotice('');
    if (!print) setPreview(null);
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    try {
      const event = await readEvent(eventId, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      const data = invitationData(event, window.location.origin);
      if (print && preview && JSON.stringify(preview.data) === JSON.stringify(data)) {
        await resources(sheet.current);
        if (controller.signal.aborted) return;
        setReady(true);
        if (typeof window.print !== 'function') setNotice('Открой встречу в обычном браузере и выбери печать');
        else { try { window.print(); } catch { setNotice('Открой встречу в обычном браузере и выбери печать'); } }
      } else {
        const qr = await createInvitationQr(data.url).catch(() => { throw new Error('Не удалось создать QR-код. Попробуй ещё раз.'); });
        if (controller.signal.aborted) return;
        setPreview({ data, qr });
        if (print) setNotice('Сведения встречи изменились. Проверь приглашение и нажми «Печать» ещё раз.');
      }
    } catch (problem) {
      if (!controller.signal.aborted) { setPreview(null); setReady(false); setError(failureMessage(problem)); }
    } finally {
      if (request.current === controller) { lock.current = false; setBusy(false); }
    }
  }
  function changeOpen(value: boolean) {
    setOpen(value);
    if (value) void prepare();
    else { request.current?.abort(); lock.current = false; setBusy(false); setReady(false); setPreview(null); setError(''); setNotice(''); }
  }
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><Button variant="secondary">Печатное приглашение</Button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content ref={dialog} data-invitation-dialog className={styles.dialog}>
        <div className={styles.controls}>
          <Dialog.Title>Печатное приглашение</Dialog.Title>
          <Dialog.Description>Длинные условия могут занять несколько страниц</Dialog.Description>
          {busy && <p role="status">Проверяем встречу и готовим приглашение…</p>}
          {error && <div role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void prepare()} disabled={busy}>Повторить</Button></div>}
          {notice && <p role="status">{notice}</p>}
          <div className={styles.actions}>
            <Button disabled={!ready || busy || !preview || !!error} onClick={() => void prepare(true)}>Печать</Button>
            <Dialog.Close asChild><Button variant="secondary">Закрыть</Button></Dialog.Close>
          </div>
        </div>
        <div ref={sheet}>{preview && <InvitationSheet data={preview.data} qr={preview.qr} />}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
