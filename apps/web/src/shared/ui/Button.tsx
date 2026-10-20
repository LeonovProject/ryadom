import type { ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import styles from './ui.module.css';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';
const buttonClass = (variant: Variant, className = '') =>
  `${styles.button} ${styles[variant]} ${className}`;

export function Button({
  variant = 'primary', pending = false, disabled, children, className, type = 'button', ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; pending?: boolean }) {
  return (
    <button {...props} type={type} className={buttonClass(variant, className)}
      disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = 'primary', className, ...props }: LinkProps & { variant?: Variant }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}
