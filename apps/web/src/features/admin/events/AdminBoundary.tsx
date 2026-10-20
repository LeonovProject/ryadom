import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '../../auth/SessionProvider';
import { authLink } from '../../auth/return-to';
import { Button, ButtonLink } from '../../../shared/ui/Button';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { PageTitle } from '../../../shared/ui/PageTitle';
export function AdminBoundary({ title, children }: { title: string; children: ReactNode }) {
  const session = useSession(), location = useLocation();
  if (session.status === 'authenticated' && session.me?.systemRole === 'ADMIN' && !session.logoutPending) return <div key={session.me.account.id}>{children}</div>;
  return <><PageTitle title={title} />{session.status === 'loading' || session.logoutPending ? <StatePanel kind="loading" title="Проверяем доступ" /> : session.status === 'error' ? <StatePanel kind="error" title="Не удалось проверить доступ" action={<Button onClick={() => void session.refresh()}>Проверить вход</Button>}>Административные данные скрыты.</StatePanel> : !session.me ? <StatePanel kind="unavailable" title="Войди, чтобы проверить доступ" action={<ButtonLink to={authLink('/login', location.pathname + location.search)}>Войти</ButtonLink>}>Этот раздел доступен администратору.</StatePanel> : <StatePanel kind="unavailable" title="Нет доступа к разделу">Этот раздел доступен администратору.</StatePanel>}</>;
}
