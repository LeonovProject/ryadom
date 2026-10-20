import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../features/auth/SessionProvider';
import { authLink } from '../features/auth/return-to';
import { EventFeed } from '../features/events/catalog/EventFeed';
import { useActivityTypes } from '../features/events/catalog/queries';
import { Button, ButtonLink } from '../shared/ui/Button';
import { TextField } from '../shared/ui/Field';
import { StatePanel } from '../shared/ui/StatePanel';
import markWhiteUrl from '../../../../brandbook/assets/mark-white.svg';
import styles from './home.module.css';

export function HomePage({ personalPlans }: { personalPlans?: ReactNode }) {
  const session = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [from, setFrom] = useState(() => new Date().toISOString());
  const [searchError, setSearchError] = useState<string | null>(null);
  const types = useActivityTypes();
  function find(event: FormEvent) {
    event.preventDefault();
    if (Array.from(q.trim()).length > 200 || Array.from(city.trim()).length > 120) { setSearchError('Сократи название города или поисковый запрос.'); return; }
    const params = new URLSearchParams({ from: new Date().toISOString() });
    if (q.trim()) params.set('q', q.trim());
    if (city.trim()) params.set('city', city.trim());
    navigate(`/events?${params}`);
  }
  return <div className={styles.page}>
    {session.status === 'authenticated' ? <section className={styles.personal}>
      <p className={styles.eyebrow}>Твой Рядом</p>
      <h1 tabIndex={-1}>Мои встречи</h1>
      {personalPlans ?? <div className={styles.personalLinks}><p className={styles.muted}>Открой свои участия, заявки и встречи, которые ты организуешь.</p><ButtonLink to="/me/events">Все мои встречи</ButtonLink></div>}
    </section> : session.status === 'loading' ? <section className={styles.personal}><h1 tabIndex={-1}>Рядом — компания для спорта</h1><StatePanel kind="loading" title="Проверяем текущий вход" /></section>
      : <section className={styles.hero}>
        <div className={styles.heroCopy}><p className={styles.eyebrow}>Спорт начинается с компании</p><h1 tabIndex={-1}>Найди компанию<br />для своих планов</h1>
          <p className={styles.lead}>Бег, футбол, шахматы или что-то новое. Выбирай встречу по интересам, читай условия и присоединяйся.</p>
          <div className={styles.heroActions}><a href="#find-meeting" className={styles.primaryLink}>Найти встречу ↓</a><ButtonLink to={authLink('/login', '/events/new')} variant="quiet">Создать встречу</ButtonLink></div>
        </div>
        <div className={styles.heroArt} aria-hidden="true"><img src={markWhiteUrl} alt="" /><span className={styles.artCircle} /><p>Свой темп.<br />Общий интерес.</p><span className={styles.artNote}>Рядом — компания для спорта</span></div>
      </section>}
    <section id="find-meeting" className={styles.searchSection}>
      <h2>{session.me ? 'Найти новую встречу' : 'Что хочется попробовать?'}</h2>
      <form className={styles.search} onSubmit={find} noValidate aria-label="Поиск на главной">
        <TextField label="Спорт или название" type="search" value={q} placeholder="Например, бег или шахматы" onChange={(event) => { setQ(event.target.value); setSearchError(null); }} />
        <TextField label="Город" value={city} placeholder="Все города" onChange={(event) => { setCity(event.target.value); setSearchError(null); }} />
        <Button type="submit">Найти встречи</Button>
      </form>
      {searchError && <p role="alert" className={styles.error}>{searchError}</p>}
      {types.isPending && <p role="status" className={styles.muted}>Загружаем направления…</p>}
      {types.isError && <div className={styles.typeError}><p>Направления не загрузились. Можно искать по названию.</p><Button variant="quiet" onClick={() => void types.refetch()}>Повторить загрузку направлений</Button></div>}
      {!!types.data?.length && <ul className={styles.types} aria-label="Направления">{types.data.map((item) => <li key={item.id}><Link to={`/events?${new URLSearchParams({ activityTypeId: item.id, from })}`}>{item.name}</Link></li>)}</ul>}
    </section>
    <section className={styles.meetings}>
      <div className={styles.sectionHeader}><div><p className={styles.eyebrow}>Встречаемся и пробуем</p><h2>Ближайшие встречи</h2></div><ButtonLink to={`/events?${new URLSearchParams({ from })}`} variant="quiet">Все встречи →</ButtonLink></div>
      <EventFeed query={{ limit: 6, from }} preview onRestart={() => setFrom(new Date().toISOString())} />
    </section>
    {!session.me && <section className={styles.steps} aria-label="Как это работает">
      {[['01', 'Выбери встречу', 'Найди спорт и время, которые подходят тебе.'], ['02', 'Посмотри условия', 'Уточни место, подготовку и что взять с собой.'], ['03', 'Присоединяйся', 'Свободно или по заявке — режим указан во встрече.']].map(([number, title, text]) => <div key={number}><span>{number}</span><div><h2>{title}</h2><p>{text}</p></div></div>)}
    </section>}
    <section className={styles.community}><div><h2>Собираешь свой клуб?</h2><p>Расскажи о сообществе и подай заявку. После допуска можно публиковать встречи от его имени.</p></div><ButtonLink to={session.me ? '/organizations/new' : authLink('/login', '/organizations/new')} variant="secondary">Создать организацию</ButtonLink></section>
  </div>;
}
