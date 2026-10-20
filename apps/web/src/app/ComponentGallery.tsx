import { useState } from 'react';
import { Button } from '../shared/ui/Button';
import { Dialog } from '../shared/ui/Dialog';
import { TextField, TextAreaField } from '../shared/ui/Field';
import { StatePanel } from '../shared/ui/StatePanel';
import { StatusBadge } from '../shared/ui/StatusBadge';
import { formatEventStart } from '../shared/lib/event-time';
import styles from './app.module.css';

export function ComponentGallery() {
  const [state, setState] = useState<'loading' | 'empty' | 'error' | 'unavailable'>('empty');
  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>FE-01 · Для проверки интерфейса</p>
        <h1 tabIndex={-1}>Общие компоненты</h1>
        <p className={styles.lead}>Кнопки, поля, диалоги и состояния. Примеры не отправляют запросы и не меняют данные.</p>
      </div>
      <section className={styles.card}>
        <h2>Действия</h2>
        <div className={styles.row}>
          <Dialog trigger={<Button>Открыть диалог</Button>} title="Пример диалога" description="Проверь переход по Tab, закрытие по Escape и возврат фокуса на кнопку открытия.">
            <TextField label="Текст для проверки" hint="Это поле только для проверки фокуса." />
          </Dialog>
          <Button variant="secondary" onClick={() => setState('empty')}>Показать пустой список</Button>
          <Button pending>Отправляем…</Button>
          <Button disabled>Недоступно</Button>
        </div>
      </section>
      <section className={styles.card}>
        <h2>Поля и подсказки</h2>
        <div className={styles.grid}>
          <TextField label="Название" hint="Пример поля с подсказкой." placeholder="Название встречи" />
          <TextField label="Email" type="email" autoComplete="email" required error="Укажи email в формате name@example.ru." defaultValue="example" />
          <TextAreaField label="Организационная информация" hint="Текст можно выделить, скопировать и изменить." placeholder="Где собираемся и что взять с собой" />
        </div>
      </section>
      <section className={styles.card}>
        <h2>Состояния данных</h2>
        <div className={styles.row} aria-label="Выбор примера состояния">
          <Button variant="secondary" onClick={() => setState('loading')}>Загрузка</Button>
          <Button variant="secondary" onClick={() => setState('empty')}>Пустой список</Button>
          <Button variant="secondary" onClick={() => setState('error')}>Ошибка</Button>
          <Button variant="secondary" onClick={() => setState('unavailable')}>Нет доступа</Button>
        </div>
        {state === 'loading' && <StatePanel kind="loading" title="Загружаем данные">Пример состояния ожидания.</StatePanel>}
        {state === 'empty' && <StatePanel kind="empty" title="Пока ничего нет">Здесь появятся данные после их получения.</StatePanel>}
        {state === 'error' && <StatePanel kind="error" title="Не удалось загрузить данные" action={<Button variant="secondary" onClick={() => setState('loading')}>Повторить пример</Button>}>Результат запроса неизвестен. Этот пример не обращается к серверу.</StatePanel>}
        {state === 'unavailable' && <StatePanel kind="unavailable" title="Нет доступа">Пример сообщения о недоступности раздела.</StatePanel>}
      </section>
      <section className={styles.card}>
        <h2>Участие, публикация и допуск</h2>
        <p>Это независимые состояния. Подписи берутся из брендбука.</p>
        <div className={styles.row}>
          <StatusBadge domain="participation" status="PENDING" />
          <StatusBadge domain="participation" status="CONFIRMED" />
          <StatusBadge domain="participation" status="REJECTED" />
        </div>
        <div className={styles.row}>
          <StatusBadge domain="publication" status="PUBLISHED" />
          <StatusBadge domain="publication" status="UNPUBLISHED" />
        </div>
        <div className={styles.row}>
          <StatusBadge domain="organization" status="NOT_SUBMITTED" />
          <StatusBadge domain="organization" status="PENDING" />
          <StatusBadge domain="organization" status="APPROVED" />
          <StatusBadge domain="organization" status="REJECTED" />
        </div>
      </section>
      <section className={styles.card}>
        <h2>Время в зоне встречи</h2>
        <p>Пример: <time dateTime="2026-11-07T00:00:00Z">{formatEventStart({ startsAt: '2026-11-07T00:00:00Z', timezone: 'Asia/Krasnoyarsk' })}</time></p>
        <p>Зона встречи: Asia/Krasnoyarsk. Зона устройства не меняет дату и время.</p>
      </section>
    </div>
  );
}
