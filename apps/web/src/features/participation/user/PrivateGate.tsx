import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '../../auth/SessionProvider';
import { authLink } from '../../auth/return-to';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { Button, ButtonLink } from '../../../shared/ui/Button';

export function PrivateGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (session.status === 'loading' || session.logoutPending) return <StatePanel kind="loading" title="Проверяем текущий вход" />;
  if (session.status === 'error') return <StatePanel kind="error" title="Не удалось проверить вход" action={<Button onClick={() => void session.refresh()}>Проверить ещё раз</Button>}>Личные данные появятся после проверки аккаунта.</StatePanel>;
  if (!session.me) return <StatePanel kind="unavailable" title="Войди, чтобы открыть свои встречи" action={<ButtonLink to={authLink('/login', location.pathname + location.search)}>Войти</ButtonLink>}>После входа откроется этот раздел. Действия не выполняются автоматически.</StatePanel>;
  return children;
}
