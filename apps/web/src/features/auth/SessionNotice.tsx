import { useSession } from './SessionProvider';
import styles from './auth.module.css';

export function SessionNotice() {
  const { notice } = useSession();
  if (!notice) return null;
  return <p role="status" className={styles.notice}>{notice === 'blocked' ? 'Аккаунт заблокирован. Публичные встречи можно просматривать без входа.' : 'Сессия завершилась. Войди снова, чтобы продолжить.'}</p>;
}
