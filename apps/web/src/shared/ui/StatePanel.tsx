import type { ReactNode } from 'react';
import styles from './ui.module.css';

export function StatePanel({ kind, title, children, action }: {
  kind: 'loading' | 'empty' | 'error' | 'unavailable'; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <section className={`${styles.state} ${kind === 'error' ? styles.stateError : ''}`}
      role={kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined}
      aria-busy={kind === 'loading' || undefined}>
      {kind === 'loading' && <span className={styles.spinner} aria-hidden="true" />}
      <h2>{title}</h2>
      {children && <p className={styles.hint}>{children}</p>}
      {action && <div className={styles.actions}>{action}</div>}
    </section>
  );
}
