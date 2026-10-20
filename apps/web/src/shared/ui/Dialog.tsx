import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { Button } from './Button';
import styles from './ui.module.css';

export function Dialog({ trigger, title, description, children, open, onOpenChange }: {
  trigger: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content className={styles.dialog}>
          <RadixDialog.Title className={styles.dialogTitle}>{title}</RadixDialog.Title>
          <RadixDialog.Description className={styles.hint}>{description}</RadixDialog.Description>
          {children}
          <div className={styles.dialogFooter}>
            <RadixDialog.Close asChild><Button variant="secondary">Закрыть</Button></RadixDialog.Close>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
