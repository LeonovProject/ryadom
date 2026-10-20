import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { components } from '../../../shared/api/client';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { useResourceQuery } from '../../../shared/api/resource-query';
import { Button, ButtonLink } from '../../../shared/ui/Button';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { ResourceState } from '../../../shared/ui/ResourceState';
import { StatusBadge } from '../../../shared/ui/StatusBadge';
import { useSession } from '../../auth/SessionProvider';
import { readOrganization } from './api';
import { OrganizationEvents } from './OrganizationEvents';
import { OrganizationGate } from './OrganizationGate';
import { OrganizationSubmission } from './OrganizationSubmission';
import styles from './organizations.module.css';

export function OrganizationCabinetPage() {
  const { organizationId = '' } = useParams();
  const session = useSession();
  return <div className={styles.page}>
    <Link to="/me/organizations">← Мои организации</Link>
    {(!session.me || session.logoutPending) && <PageTitle title="Кабинет организации" />}
    <OrganizationGate>{(me) => <Cabinet key={`${me.account.id}:${organizationId}`} me={me} organizationId={organizationId} />}</OrganizationGate>
  </div>;
}
function Cabinet({ me, organizationId }: { me: components['schemas']['Me']; organizationId: string }) {
  const query = useResourceQuery('private-organization', organizationId, (id, signal) => readOrganization(id, me.account.id, signal));
  const session = useSession();
  const organization = query.isError ? undefined : query.data;
  const lastSync = useRef('');
  useEffect(() => {
    if (!organization) return;
    const reference = me.organizations.find((item) => item.id === organization.id);
    const signature = `${sessionEpoch()}:${organization.id}:${organization.approvalState}:${organization.canPublish}`;
    if ((!reference || reference.approvalState !== organization.approvalState || reference.canPublish !== organization.canPublish) && lastSync.current !== signature) {
      lastSync.current = signature; void session.refresh();
    }
  }, [organization, me.organizations, session.refresh]);
  if (query.isPending || query.isError || !organization) return <ResourceState error={query.error} loadingTitle="Открываем кабинет организации" notFoundTitle="Кабинет организации не найден" retry={() => void query.refetch()} />;
  const approved = organization.approvalState === 'APPROVED';
  return <>
    <div className={styles.intro}><p className={styles.eyebrow}>Закрытый кабинет</p><PageTitle title={organization.name} /><StatusBadge domain="organization" status={organization.approvalState} /></div>
    <section className={styles.card} aria-label="Профиль организации"><h2>О профиле</h2><p className={styles.text}>{organization.description}</p>
      <dl className={styles.facts}><div><dt>Спортивные интересы</dt><dd className={styles.text}>{organization.sportInterests}</dd></div><div><dt>Ответственный</dt><dd>{organization.owner.displayName}</dd></div></dl>
    </section>
    <section className={styles.card} aria-label="Допуск организации"><h2>Допуск к публикации</h2>
      <p>{organization.approvalState === 'NOT_SUBMITTED' ? `Профиль создан и доступен только тебе. ${organization.canSubmit ? 'Отправь заявку, чтобы организация могла публиковать встречи.' : 'Отправка заявки сейчас недоступна. Обнови сведения, чтобы проверить доступные действия.'}`
        : organization.approvalState === 'PENDING' ? 'Заявка на проверке. Публичная страница и публикация встреч появятся после допуска администратора.'
          : organization.approvalState === 'REJECTED' ? 'В допуске отказано. Профиль остаётся закрытым. Повторная подача в этой версии не предусмотрена.'
            : 'Организация допущена к публикации. Встречи выходят сразу, без повторного согласования каждой встречи.'}</p>
      {organization.application && <dl className={styles.facts}>
        <div><dt>Заявка отправлена</dt><dd><time dateTime={organization.application.createdAt}>{formatDate(organization.application.createdAt)}</time></dd></div>
        {organization.application.reviewedAt && <div><dt>Решение принято</dt><dd><time dateTime={organization.application.reviewedAt}>{formatDate(organization.application.reviewedAt)}</time></dd></div>}
      </dl>}
      {organization.approvalState === 'REJECTED' && organization.application?.rejectionReason && <div className={styles.notice}><h3>Причина отказа</h3><p className={styles.text}>{organization.application.rejectionReason}</p></div>}
      <OrganizationSubmission key={organization.id} organization={organization} refreshing={query.isFetching} reload={async () => !(await query.refetch()).isError} />
      <div className={styles.actions}>{approved && <ButtonLink to={`/organizations/${organization.id}`} variant="secondary">Публичная страница</ButtonLink>}{approved && organization.canPublish && <ButtonLink to={`/events/new?organization=${organization.id}`}>Создать встречу от организации</ButtonLink>}
        <Button variant="quiet" pending={query.isFetching} onClick={() => void query.refetch()}>Обновить сведения</Button></div>
    </section>
    <OrganizationEvents ownerId={me.account.id} organizationId={organization.id} />
  </>;
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset' }).format(new Date(value));
}
