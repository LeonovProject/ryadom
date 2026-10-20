import markUrl from '../../../../../../brandbook/assets/mark.svg';
import { shortDescription, type InvitationData } from './data';
import styles from './invitation.module.css';

export function InvitationSheet({ data, qr }: { data: InvitationData; qr: string }) {
  const description = shortDescription(data.description);
  return <article className={styles.sheet} aria-label="Лист приглашения">
    <header className={styles.brand}><div><img src={markUrl} alt="" width="32" height="32" /><strong>рядом</strong></div><p>Спорт вместе — рядом с домом</p></header>
    <p>{data.activity}</p><h1>{data.title}</h1>
    <section className={styles.when}><h2>Когда и где</h2><p><strong>{data.when}</strong></p><p>Зона встречи: {data.timezone}</p><p>{data.city}</p><p className={styles.text}>{data.location}</p></section>
    <p><strong>{data.organizerType === 'PERSONAL' ? 'Организатор' : 'Организация'}:</strong> {data.organizer}</p>
    {data.blocked && <p className={styles.warning}>Организатор временно недоступен{data.mode === 'APPROVAL' ? '. Сейчас он не может рассматривать заявки' : ''}.</p>}
    <section><h2>О встрече</h2><p className={styles.text}>{description.text}</p>{description.shortened && <p>Описание сокращено. Полный текст — по ссылке</p>}</section>
    <section><h2>Что важно знать перед встречей</h2><p className={styles.text}>{data.conditions.trim() ? data.conditions : 'Организатор не указал условия участия. Уточни подготовку и инвентарь в обсуждении встречи'}</p></section>
    <section><h2>Как присоединиться</h2><p>{data.mode === 'OPEN' ? 'Открой встречу по ссылке и запишись. Запись подтверждается сразу' : 'Открой встречу по ссылке, отправь заявку и дождись подтверждения организатора'}.</p><p>Для записи потребуется вход в Рядом</p></section>
    <div className={styles.destination}><img src={qr} width="512" height="512" alt="QR-код ссылки на встречу" /><p><a href={data.url}>{data.url}</a></p></div>
    {data.loopback && <p className={styles.warning}>Адрес доступен только на этом устройстве. Для приглашения другим людям открой сетевой адрес сервиса</p>}
    <p>Перед выходом открой встречу по ссылке: сведения и доступность могут измениться</p>
  </article>;
}
