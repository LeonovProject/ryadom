import { useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { useSession } from './SessionProvider';
import styles from './auth.module.css';

export function LogoutButton({ children = 'Выйти' }: { children?: string }) {
  const session = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  return <div className={styles.stack}>
    <Button variant="secondary" pending={pending || session.logoutPending} onClick={async () => {
      setPending(true); setError(false);
      try { await session.logout(); } catch { setError(true); }
      finally { setPending(false); }
    }}>{pending ? 'Выходим…' : children}</Button>
    {error && <p role="alert" className={styles.error}>Не удалось подтвердить выход. Проверь соединение и повтори действие.</p>}
  </div>;
}
