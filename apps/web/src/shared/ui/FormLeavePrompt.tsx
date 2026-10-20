import * as Dialog from '@radix-ui/react-dialog';
import { useRef } from 'react';
import { Button } from './Button';
import styles from './ui.module.css';

export function FormLeavePrompt({ open, description, stay, leave }: { open: boolean; description: string; stay: () => void; leave: () => void }) {
  const previousFocus = useRef<HTMLElement | null>(null);
  return <Dialog.Root open={open} onOpenChange={(value) => { if (!value) stay(); }}><Dialog.Portal>
    <Dialog.Overlay className={styles.overlay} />
    <Dialog.Content className={styles.dialog} onOpenAutoFocus={() => { if (document.activeElement instanceof HTMLElement) previousFocus.current = document.activeElement; }} onCloseAutoFocus={(event) => { event.preventDefault(); previousFocus.current?.focus(); }}>
      <Dialog.Title className={styles.dialogTitle}>Покинуть форму?</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
      <div className={styles.dialogFooter}><Button variant="secondary" onClick={stay}>Остаться</Button><Button variant="danger" onClick={leave}>Уйти из формы</Button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
