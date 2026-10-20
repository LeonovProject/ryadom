import { profileReturnTo } from '../../features/events/detail/navigation';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useSession } from '../../features/auth/SessionProvider';
import { EventFeed } from '../../features/events/catalog/EventFeed';
import { api } from '../../shared/api/client';
import { ResourceFailure, useResourceQuery } from '../../shared/api/resource-query';
import { Avatar } from '../../shared/ui/Avatar';
import { ButtonLink } from '../../shared/ui/Button';
import { PageTitle } from '../../shared/ui/PageTitle';
import { ResourceState } from '../../shared/ui/ResourceState';
import styles from './public-account.module.css';

async function readAccount(accountId: string, signal: AbortSignal) {
  const result = await api.GET('/accounts/{accountId}', { params: { path: { accountId } }, signal, cache: 'no-store' });
  if (!result.data || result.response.status !== 200) throw new ResourceFailure(result.response.status);
  if (result.data.id.toLowerCase() !== accountId.toLowerCase()) throw new ResourceFailure(502);
  return result.data;
}

export function PublicAccountPage() {
  const { accountId = '' } = useParams();
  const session = useSession();
  const back = profileReturnTo(useLocation().state);
  const resource = useResourceQuery('public-account', accountId, readAccount);
  const account = resource.data;
  return <div className={styles.page}>
    <Link to={back.to} state={back.state} className={styles.back}>{back.label}</Link>
    {resource.isPending || resource.isError || !account ? <ResourceState error={resource.error} loadingTitle="Открываем профиль" notFoundTitle="Профиль не найден" retry={() => void resource.refetch()} />
      : <>
        <section className={styles.profile}>
          <Avatar name={account.displayName} url={account.avatarUrl} large />
          <div className={styles.intro}><p className={styles.eyebrow}>Участник Рядом</p><PageTitle title={account.displayName} />
            {account.isBlocked && <p className={styles.warning}>Аккаунт заблокирован</p>}
          </div>
          {session.me?.account.id === account.id && <ButtonLink to="/me" variant="secondary">Личный кабинет</ButtonLink>}
        </section>
        <section className={styles.section} aria-label="Встречи этого человека">
          <h2>Опубликованные встречи</h2>
          <p className={styles.muted}>Встречи, которые этот человек организует от своего имени. Сначала — по более ранней дате начала.</p>
          <EventFeed query={{ organizerAccountId: account.id, limit: 6 }} emptyTitle="Пока нет опубликованных встреч" emptyDescription="Когда этот человек опубликует встречу от своего имени, она появится здесь." allowCreate={false} />
        </section>
      </>}
  </div>;
}
