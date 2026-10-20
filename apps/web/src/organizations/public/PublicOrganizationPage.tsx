import { Link, useParams } from 'react-router-dom';
import { useSession } from '../../features/auth/SessionProvider';
import { EventFeed } from '../../features/events/catalog/EventFeed';
import { api } from '../../shared/api/client';
import { ResourceFailure, useResourceQuery } from '../../shared/api/resource-query';
import { Avatar } from '../../shared/ui/Avatar';
import { ButtonLink } from '../../shared/ui/Button';
import { PageTitle } from '../../shared/ui/PageTitle';
import { ResourceState } from '../../shared/ui/ResourceState';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import styles from './public-organization.module.css';

async function readOrganization(organizationId: string, signal: AbortSignal) {
  const result = await api.GET('/organizations/{organizationId}', { params: { path: { organizationId } }, signal, cache: 'no-store' });
  if (!result.data || result.response.status !== 200) throw new ResourceFailure(result.response.status);
  if (result.data.id.toLowerCase() !== organizationId.toLowerCase()) throw new ResourceFailure(502);
  return result.data;
}

export function PublicOrganizationPage() {
  const { organizationId = '' } = useParams();
  const session = useSession();
  const resource = useResourceQuery('public-organization', organizationId, readOrganization);
  const organization = resource.data;
  const owned = organization && session.me?.organizations.some((item) => item.id === organization.id);
  return <div className={styles.page}>
    <Link to="/events" className={styles.back}>← К встречам</Link>
    {resource.isPending || resource.isError || !organization ? <ResourceState error={resource.error} loadingTitle="Открываем организацию" notFoundTitle="Организация не найдена" retry={() => void resource.refetch()} />
      : <>
        <section className={styles.profile}>
          <Avatar name={organization.name} url={null} large />
          <div className={styles.intro}><p className={styles.eyebrow}>Организация · сообщество</p><PageTitle title={organization.name} /><StatusBadge domain="organization" status="APPROVED" />
            <p className={styles.muted}>Допуск даёт право публиковать встречи от имени организации.</p>
          </div>
          {owned && <ButtonLink to={`/me/organizations/${organization.id}`} variant="secondary">Кабинет организации</ButtonLink>}
        </section>
        {organization.ownerIsBlocked && <p className={styles.notice}>Организатор временно недоступен. Допуск организации и опубликованные встречи сохраняются; сейчас ответственный не может рассматривать заявки.</p>}
        <div className={styles.columns}>
          <section className={styles.card}><h2>О сообществе</h2><p className={styles.text}>{organization.description}</p></section>
          <section className={styles.card}><h2>Спортивные интересы</h2><p className={styles.text}>{organization.sportInterests}</p></section>
        </div>
        <section className={styles.section} aria-label="Встречи этой организации">
          <h2>Опубликованные встречи</h2><p className={styles.muted}>Сначала — по более ранней дате начала.</p>
          <EventFeed query={{ organizationId: organization.id, limit: 6 }} emptyTitle="Пока нет опубликованных встреч" emptyDescription="Здесь появятся встречи этой организации после публикации." allowCreate={false} />
        </section>
      </>}
  </div>;
}
