import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { components } from '../../../shared/api/client';
import { Button, ButtonLink } from '../../../shared/ui/Button';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { authLink } from '../../auth/return-to';
import { useSession } from '../../auth/SessionProvider';

export function OrganizationGate({ children, restore = false }: { children: (me: components['schemas']['Me']) => ReactNode; restore?: boolean }) {
  const session = useSession();
  const location = useLocation();
  const target = `${location.pathname}${location.search}`;
  if (session.status === 'loading' || session.logoutPending) return <StatePanel kind="loading" title="Проверяем вход" />;
  if (session.status === 'error') return <StatePanel kind="error" title="Не удалось проверить вход" action={<Button onClick={() => void session.refresh()}>Проверить ещё раз</Button>}>Сведения организаций доступны после подтверждения текущего аккаунта.</StatePanel>;
  if (!session.me) return <StatePanel kind="unavailable" title="Войди, чтобы открыть свои организации" action={<><ButtonLink to={authLink('/login', target)}>Войти</ButtonLink><ButtonLink to={authLink('/register', target)} variant="secondary">Создать профиль</ButtonLink></>}>
    {restore && session.notice === 'expired' ? 'Введённое осталось в памяти вкладки. Вход в тот же аккаунт вернёт форму; смена аккаунта или перезагрузка удалит её. Отправка автоматически не повторяется.' : 'Частные профили и решения по заявкам видит только ответственный за организацию.'}
  </StatePanel>;
  return children(session.me);
}
