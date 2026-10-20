import { AvatarPanel } from '../../features/media/MediaPanels';
import { DemoResetPanel } from '../../features/admin/demoreset/DemoResetPanel';
import { useLocation } from 'react-router-dom';
import { useSession } from '../../features/auth/SessionProvider';
import { LogoutButton } from '../../features/auth/LogoutButton';
import { authLink } from '../../features/auth/return-to';
import { Avatar } from '../../shared/ui/Avatar';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { StatePanel } from '../../shared/ui/StatePanel';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import styles from './profile.module.css';

export function PrivateAccountPage() {
  const session = useSession();
  const location = useLocation();
  const me = session.me;
  return <div className={styles.page}>
    <div className={styles.intro}><p className={styles.eyebrow}>Твой Рядом</p><h1 tabIndex={-1}>Личный профиль</h1></div>
    {session.status === 'loading' ? <StatePanel kind="loading" title="Загружаем профиль" />
      : session.status === 'error' ? <StatePanel kind="error" title="Не удалось загрузить профиль" action={<Button onClick={() => void session.refresh()}>Повторить загрузку</Button>}>Проверь соединение и попробуй ещё раз.</StatePanel>
        : !me ? <StatePanel kind="unavailable" title="Войди, чтобы открыть личный профиль" action={<ButtonLink to={authLink('/login', location.pathname + location.search)}>Войти</ButtonLink>}>Твои встречи и организации появятся после входа.</StatePanel>
          : <>
            <div className={styles.grid}>
              <section className={styles.card} aria-label="Данные профиля">
                <Avatar name={me.account.displayName} url={me.account.avatarUrl} large />
                <h2 className={styles.name}>{me.account.displayName}</h2>
                <div><p className={styles.email}>{me.email}</p><p className={styles.muted}>Email виден только тебе.</p></div>
                <ButtonLink variant="secondary" to={`/people/${encodeURIComponent(me.account.id)}`}>Публичный профиль</ButtonLink>
                <LogoutButton />
              </section>
              <section className={styles.card} aria-label="Твои встречи и организации">
                <h2>Твои встречи</h2>
                <p className={styles.muted}>Участие, заявки и встречи, которые ты организуешь.</p>
                <ButtonLink to="/me/events">Мои встречи</ButtonLink>
                <ButtonLink variant="secondary" to="/events/new">Создать встречу</ButtonLink>
                <h2>Организациям</h2>
                <ButtonLink variant="secondary" to="/me/organizations">Мои организации</ButtonLink>
                <ButtonLink variant="quiet" to="/organizations/new">Создать организацию</ButtonLink>
              </section>
            </div>
            {!!me.organizations.length && <section className={styles.card}>
              <h2>Твои организации</h2>
              <ul className={styles.list}>{me.organizations.map((organization) => <li key={organization.id} className={styles.organization}>
                <div><h3>{organization.name}</h3><StatusBadge domain="organization" status={organization.approvalState} /></div>
                <ButtonLink variant="secondary" to={`/me/organizations/${encodeURIComponent(organization.id)}`}>Открыть кабинет</ButtonLink>
              </li>)}</ul>
            </section>}
            {me.systemRole === 'ADMIN' && <section className={styles.card} aria-label="Модерация">
              <h2>Модерация</h2>
              <div className={styles.actions}>
                <ButtonLink to="/admin/organizations" variant="secondary">Организации</ButtonLink>
                <ButtonLink to="/admin/events" variant="secondary">Встречи</ButtonLink>
                <ButtonLink to="/admin/activity-types" variant="secondary">Направления</ButtonLink>
                <ButtonLink to="/admin/avatars" variant="secondary">Аватары</ButtonLink>
                <ButtonLink to="/admin/accounts" variant="secondary">Аккаунты</ButtonLink>
              </div>
            </section>}
            <AvatarPanel />
            <DemoResetPanel />
          </>}
  </div>;
}
