import { Link, useLocation, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '../../../shared/ui/Button';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { ResourceState } from '../../../shared/ui/ResourceState';
import { StatusBadge } from '../../../shared/ui/StatusBadge';
import { useResourceQuery } from '../../../shared/api/resource-query';
import { AdminGate } from './AdminGate';
import { readOrganization } from './api';
import { safeListSearch } from './filters';
import { formatDate } from './OrganizationListPage';
import { useDecision } from './useDecision';
import { DecisionControls, DecisionNotice } from './DecisionControls';
import styles from './organizations.module.css';

export function OrganizationReviewPage() {
  const { organizationId = '' } = useParams();
  return <AdminGate><OrganizationReview key={organizationId} id={organizationId} /></AdminGate>;
}
function OrganizationReview({ id }: { id: string }) {
  const location = useLocation();
  const query = useResourceQuery('admin-organization', id, readOrganization);
  const organization = !query.error ? query.data : undefined;
  const decision = useDecision(organization, query.isFetching, async () => { const result = await query.refetch(); return result.isError ? undefined : result.data; });
  return <div className={styles.page}>
    <Link to={`/admin/organizations${safeListSearch(location.search)}`}>← К списку организаций</Link>
    <DecisionNotice decision={decision} refreshing={query.isFetching} pendingApplication={organization?.approvalState === 'PENDING'} />
    {!organization ? <ResourceState error={query.error} loadingTitle="Открываем профиль организации" notFoundTitle="Организация не найдена" retry={() => void query.refetch()} /> : <>
      <div className={styles.intro}><p className={styles.eyebrow}>Модерация организаций</p><PageTitle title={organization.name} /><StatusBadge domain="organization" status={organization.approvalState} /></div>
      <section className={styles.card} aria-label="Профиль организации"><h2>Об организации</h2><p className={styles.text}>{organization.description}</p>
        <dl className={styles.facts}><div><dt>Спортивные интересы</dt><dd className={styles.text}>{organization.sportInterests}</dd></div>
          <div><dt>Ответственный</dt><dd><Link to={`/people/${organization.owner.id}`}>{organization.owner.displayName}</Link>{organization.owner.isBlocked && <p>Аккаунт заблокирован. Состояние допуска организации не изменено.</p>}</dd></div>
          <div><dt>Профиль создан</dt><dd><time dateTime={organization.createdAt}>{formatDate(organization.createdAt)}</time></dd></div></dl>
        <div className={styles.actions}><ButtonLink to={`/admin/events?organizationId=${organization.id}`} variant="secondary">Встречи организации</ButtonLink>{organization.approvalState === 'APPROVED' && <ButtonLink to={`/organizations/${organization.id}`} variant="quiet">Публичная страница</ButtonLink>}</div>
      </section>
      <section className={styles.card} aria-label="Заявка организации"><h2>Допуск к публикации</h2>
        {organization.approvalState === 'NOT_SUBMITTED' ? <p>Заявка не отправлена. Решение можно принять после её подачи ответственным за организацию.</p>
          : organization.approvalState === 'PENDING' ? <p>Проверь деятельность и спортивные интересы перед решением. Допуск разрешит организации публиковать встречи.</p>
            : <p>Решение принято. Повторное рассмотрение и изменение решения не предусмотрены.</p>}
        {organization.application && <dl className={styles.facts}>
          <div><dt>Заявка отправлена</dt><dd><time dateTime={organization.application.createdAt}>{formatDate(organization.application.createdAt)}</time></dd></div>
          {organization.application.reviewedAt && <div><dt>Решение принято</dt><dd><time dateTime={organization.application.reviewedAt}>{formatDate(organization.application.reviewedAt)}</time></dd></div>}
          {organization.application.reviewedBy && <div><dt>Администратор</dt><dd><Link to={`/people/${organization.application.reviewedBy}`}>Профиль принявшего решение</Link></dd></div>}
        </dl>}
        {organization.approvalState === 'REJECTED' && organization.application?.rejectionReason && <div className={styles.notice}><h3>Причина отказа</h3><p className={styles.text}>{organization.application.rejectionReason}</p></div>}
        <DecisionControls decision={decision} refreshing={query.isFetching} />
        <div className={styles.actions}><Button variant="quiet" pending={query.isFetching} disabled={decision.pending} onClick={() => void query.refetch()}>Обновить профиль</Button></div>
      </section>
    </>}
  </div>;
}
