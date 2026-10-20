import { useState } from 'react';
import styles from './ui.module.css';

export function Avatar({ name, url, large = false }: { name: string; url: string | null; large?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initials = Array.from(name.trim()).slice(0, 2).join('').toLocaleUpperCase('ru-RU') || 'Р';
  return <span className={`${styles.avatar} ${large ? styles.avatarLarge : ''}`}>
    {url && failedUrl !== url
      ? <img src={url} alt="" onError={() => setFailedUrl(url)} />
      : <span aria-hidden="true">{initials}</span>}
  </span>;
}
