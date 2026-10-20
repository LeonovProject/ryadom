import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '../../auth/SessionProvider';
import { authLink } from '../../auth/return-to';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { Button, ButtonLink } from '../../../shared/ui/Button';
import { StatePanel } from '../../../shared/ui/StatePanel';

export function AdminGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (session.status === 'authenticated' && session.me?.systemRole === 'ADMIN' && !session.logoutPending) return <div key={session.me.account.id}>{children}</div>;
  return <><PageTitle title="Модерация организаций" />
    {session.status === 'loading' || session.logoutPending ? <StatePanel kind="loading" title="Проверяем доступ" />
      : session.status === 'error' ? <StatePanel kind="error" title="Не удалось проверить доступ" action={<Button onClick={() => void session.refresh()}>Проверить ещё раз</Button>}>Нужно подтвердить текущий аккаунт.</StatePanel>
        : !session.me ? <StatePanel kind="unavailable" title="Войди, чтобы проверить доступ" action={<ButtonLink to={authLink('/login', `${location.pathname}${location.search}`)}>Войти</ButtonLink>}>Раздел доступен администратору.</StatePanel>
          : <StatePanel kind="unavailable" title="Нет доступа к разделу" action={<ButtonLink to="/" variant="secondary">На главную</ButtonLink>}>Рассматривать организации может администратор.</StatePanel>}
  </>;
}
