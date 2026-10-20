import { Link, useSearchParams } from 'react-router-dom';
import { ButtonLink } from '../../shared/ui/Button';
import { authLink, safeReturnTo } from '../auth/return-to';
import { useSession } from '../auth/SessionProvider';
import { demoAccounts } from './demo-access';
import styles from './demo.module.css';

export function DemoPage() {
  const session = useSession();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  return <div className={styles.page}>
    <header className={styles.intro}>
      <p className={styles.eyebrow}>Проверка прототипа</p>
      <h1 tabIndex={-1}>Демонстрационные аккаунты</h1>
      <p>Выбери, от чьего имени проверить Рядом. Это вымышленные аккаунты начального набора данных.</p>
      <a className={styles.download} href="/demo/accounts.txt" download="ryadom-demo-accounts.txt">Скачать аккаунты и описания (.txt)</a>
    </header>
    <aside className={styles.notice} aria-label="Условия демонстрации">
      <p>«Подставить данные» откроет форму входа. Нажми «Войти», чтобы сервер проверил пароль и создал сессию.</p>
      {session.me && <p>Сейчас выполнен вход: <strong>{session.me.account.displayName}</strong>. Для смены аккаунта сначала <Link to={authLink('/login', returnTo)}>выйди через форму входа</Link>.</p>}
      <p>После действий команды и экспертов состояния могут отличаться от начального набора. Часть функций ещё в разработке; наличие аккаунта не означает готовность всех сценариев.</p>
    </aside>
    <ul className={styles.grid}>
      {demoAccounts.map((account) => <li key={account.key} className={styles.card}>
        <h2>{account.name}</h2>
        <p><strong>{account.label}</strong></p>
        <p>{account.description}</p>
        <dl className={styles.credentials}><dt>Email</dt><dd>{account.email}</dd><dt>Пароль</dt><dd><code>{account.password}</code></dd></dl>
        <ButtonLink variant="secondary" to={authLink('/login', returnTo)} state={{ demoAccount: account.key }}>Подставить данные: {account.name}</ButtonLink>
      </li>)}
    </ul>
    <p>Организация — отдельная страница под управлением пользователя. Для её проверки используй Анну. Данные для входа не меняют права аккаунта.</p>
  </div>;
}
