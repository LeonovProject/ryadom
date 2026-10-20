import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ButtonLink } from '../../../shared/ui/Button';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { StatusBadge } from '../../../shared/ui/StatusBadge';
import { OrganizationGate } from './OrganizationGate';
import { OrganizationListFailure, organizationListKey, uniqueOrganizations, useOrganizations } from './queries';
import styles from './organizations.module.css';

export function MyOrganizationsPage() {
  return <div className={styles.page}>
    <div className={styles.intro}><p className={styles.eyebrow}>Клубы и сообщества</p><PageTitle title="Мои организации" /><p className={styles.muted}>Создай профиль своего объединения и отправь заявку на допуск к публикации встреч.</p></div>
    <OrganizationGate>{(me) => <OrganizationList key={me.account.id} ownerId={me.account.id} />}</OrganizationGate>
  </div>;
}
function OrganizationList({ ownerId }: { ownerId: string }) {
  const query = useOrganizations(ownerId);
  const client = useQueryClient();
  const items = uniqueOrganizations(query.data?.pages ?? []);
  const cursorError = query.error instanceof OrganizationListFailure && query.error.invalidCursor;
  const restart = () => void client.resetQueries({ queryKey: organizationListKey(ownerId), exact: true });
  const fatal = query.isError && (!query.isFetchNextPageError || (query.error instanceof OrganizationListFailure && query.error.status !== 500 && !cursorError));
  const initialFailure = !query.data && query.isError;
  return <>
    <div className={styles.actions}><ButtonLink to="/organizations/new">Создать организацию</ButtonLink><Button variant="secondary" pending={query.isFetching} onClick={restart}>Обновить список</Button></div>
    {query.isPending ? <StatePanel kind="loading" title="Загружаем свои организации" />
      : fatal || initialFailure ? <StatePanel kind="error" title="Не удалось загрузить организации" action={<Button onClick={restart}>Повторить загрузку</Button>}>Сведения сейчас недоступны. Пустой список не подтверждён.</StatePanel>
        : <>
          {query.isError && <StatePanel kind="error" title={cursorError ? 'Список нужно обновить' : 'Не удалось загрузить следующую страницу'} action={<Button onClick={cursorError ? restart : () => void query.fetchNextPage()}>{cursorError ? 'Начать список заново' : 'Повторить загрузку'}</Button>}>Уже загруженные организации сохранены. Их состояние могло измениться.</StatePanel>}
          {!items.length && !query.isError ? <StatePanel kind="empty" title="Пока нет своих организаций">Профиль клуба или сообщества поможет публиковать встречи от общего имени после допуска. Личные встречи можно создавать от себя.</StatePanel>
            : <div className={styles.list} aria-label="Свои организации">{items.map((org) => <article key={org.id} className={styles.card}>
              <div className={styles.row}><h2><Link to={`/me/organizations/${org.id}`}>{org.name}</Link></h2><StatusBadge domain="organization" status={org.approvalState} /></div>
              <p className={styles.text}>{org.description}</p><p className={styles.muted}>Спортивные интересы: <span className={styles.text}>{org.sportInterests}</span></p>
              {org.approvalState === 'REJECTED' && org.application?.rejectionReason && <p className={styles.notice}>Причина отказа: <span className={styles.text}>{org.application.rejectionReason}</span></p>}
              <div className={styles.actions}><ButtonLink to={`/me/organizations/${org.id}`} variant="secondary">Открыть кабинет</ButtonLink>
                {org.approvalState === 'APPROVED' && org.canPublish && <ButtonLink to={`/events/new?organization=${org.id}`}>Создать встречу</ButtonLink>}</div>
            </article>)}</div>}
          {query.hasNextPage && !cursorError && <Button variant="secondary" pending={query.isFetchingNextPage} disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>Показать ещё организации</Button>}
        </>}
  </>;
}
