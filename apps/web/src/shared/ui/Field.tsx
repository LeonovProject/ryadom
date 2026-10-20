import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import styles from './ui.module.css';

type FieldProps = { label: string; hint?: string; error?: string };

export function TextField({ label, hint, error, id, ...props }: InputHTMLAttributes<HTMLInputElement> & FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const describedBy = [props['aria-describedby'], hint && `${fieldId}-hint`, error && `${fieldId}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={fieldId}>{label}{props.required && <span> (обязательно)</span>}</label>
      {hint && <p id={`${fieldId}-hint`} className={styles.hint}>{hint}</p>}
      <input {...props} id={fieldId} aria-invalid={error ? true : props['aria-invalid']} aria-describedby={describedBy} />
      {error && <p id={`${fieldId}-error`} className={styles.fieldError}>{error}</p>}
    </div>
  );
}

export function TextAreaField({ label, hint, error, id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const describedBy = [props['aria-describedby'], hint && `${fieldId}-hint`, error && `${fieldId}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={fieldId}>{label}{props.required && <span> (обязательно)</span>}</label>
      {hint && <p id={`${fieldId}-hint`} className={styles.hint}>{hint}</p>}
      <textarea {...props} id={fieldId} rows={props.rows ?? 4} aria-invalid={error ? true : props['aria-invalid']} aria-describedby={describedBy} />
      {error && <p id={`${fieldId}-error`} className={styles.fieldError}>{error}</p>}
    </div>
  );
}
