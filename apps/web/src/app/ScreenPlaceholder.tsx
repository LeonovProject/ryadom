import { Link } from 'react-router-dom';
import { ButtonLink } from '../shared/ui/Button';
import { StatePanel } from '../shared/ui/StatePanel';
import type { ScreenRoute } from './routes';
import styles from './app.module.css';

export function ScreenPlaceholder({ route }: { route: ScreenRoute }) {
  return (
    <div className={styles.page}>
      {route.path !== '/' && <Link to="/" className={styles.backLink}>← На главную</Link>}
      <div className={styles.intro}>
        <p className={styles.eyebrow}>Компания для спорта</p>
        <h1 tabIndex={-1}>{route.title}</h1>
        <p className={styles.lead}>Вместе проще сделать первый шаг.</p>
      </div>
      <StatePanel kind="unavailable" title="Раздел готовится">
        Здесь появится {route.title === 'Рядом' ? 'главная страница' : 'содержимое раздела'}. Пока данные и действия недоступны.
      </StatePanel>
      {import.meta.env.DEV && <p className={styles.developmentNote}>{route.screen} · Следующая реализация: {route.task}. Подключён только маршрут.</p>}
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className={styles.page}>
      <h1 tabIndex={-1}>Страница не найдена</h1>
      <StatePanel kind="unavailable" title="Проверь адрес страницы" action={<ButtonLink to="/">На главную</ButtonLink>}>
        Возможно, в ссылке есть опечатка.
      </StatePanel>
    </div>
  );
}

export function RouteErrorPage() {
  return (
    <main className={`${styles.container} ${styles.main} ${styles.page}`}>
      <h1 tabIndex={-1}>Не удалось открыть страницу</h1>
      <StatePanel kind="error" title="Произошла ошибка" action={<a href="/">На главную</a>}>
        Обнови страницу. Если ошибка повторится, попробуй вернуться позже.
      </StatePanel>
    </main>
  );
}
