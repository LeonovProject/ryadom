import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import markUrl from '../../../../brandbook/assets/mark.svg';
import { ButtonLink } from '../shared/ui/Button';
import { Avatar } from '../shared/ui/Avatar';
import { useSession } from '../features/auth/SessionProvider';
import { SessionNotice } from '../features/auth/SessionNotice';
import { demoAccessEnabled } from '../features/demo/demo-access';
import styles from './app.module.css';

export function AppShell() {
  const { pathname } = useLocation();
  const session = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>К содержимому</a>
      <header className={styles.header}>
        <div className={`${styles.container} ${styles.headerInner}`}>
          <Link to="/" className={styles.brand} aria-label="Рядом — главная">
            <img src={markUrl} alt="" width="40" height="40" />рядом
          </Link>
          <button ref={menuButton} className={styles.menuButton} type="button" aria-controls="site-navigation"
            aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? 'Закрыть' : 'Меню'}
          </button>
          <nav id="site-navigation" aria-label="Основная навигация" className={styles.navigation} data-open={menuOpen}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
            }}>
            <div className={styles.navLinks}>
              <NavLink to="/events">Найти встречу</NavLink>
              <NavLink to="/me/events">Мои встречи</NavLink>
              <NavLink to="/me/organizations">Организациям</NavLink>
            </div>
            <div className={styles.accountLinks}>
              {session.me ? <Link to="/me" className={styles.account} aria-label={`Личный профиль: ${session.me.account.displayName}`}>
                <Avatar name={session.me.account.displayName} url={session.me.account.avatarUrl} />
                <span>{session.me.account.displayName}</span>
              </Link> : session.status === 'loading' ? <span role="status">Проверяем вход…</span> : <>
                <ButtonLink to="/login" variant="quiet">Войти</ButtonLink>
                <ButtonLink to="/register" variant="secondary">Регистрация</ButtonLink>
              </>}
            </div>
          </nav>
        </div>
      </header>
      <div className={styles.buildNotice}>Приложение в разработке. Часть разделов ещё недоступна.</div>
      {session.notice && <div className={styles.container}><SessionNotice /></div>}
      <main id="main-content" tabIndex={-1} className={`${styles.container} ${styles.main}`}>
        <RouteFocus />
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerInner}`}>
          <p>Рядом — компания для спорта.</p>
          {demoAccessEnabled && <Link to="/demo">Демоаккаунты</Link>}
          {import.meta.env.DEV && <Link to="/dev/ui">Компоненты интерфейса</Link>}
        </div>
      </footer>
    </div>
  );
}

function RouteFocus() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('main h1');
    if (heading) {
      document.title = pathname === '/' ? 'Рядом — компания для спорта' : `${heading.textContent} — Рядом`;
      // A fresh document starts at the skip link. Only SPA transitions move focus.
      if (previousPath.current !== pathname) heading.focus({ preventScroll: true });
    }
    if (previousPath.current !== pathname) window.scrollTo({ top: 0 });
    previousPath.current = pathname;
  }, [pathname]);
  return null;
}
