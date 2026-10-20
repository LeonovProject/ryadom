import type { ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import type { components } from '../../../shared/api/client';
import { formatEventStart } from '../../../shared/lib/event-time';
import { Button } from '../../../shared/ui/Button';
import { TextAreaField, TextField } from '../../../shared/ui/Field';
import { useActivityTypes } from '../catalog/queries';
import { eventInput, type EventErrors, type EventField, type EventValues } from './validation';
import styles from './create.module.css';

type StepProps = { values: EventValues; errors: EventErrors; change: (field: EventField, value: string) => void; me: components['schemas']['Me'] };

export function BasicsStep({ values, errors, change, me }: StepProps) {
  const types = useActivityTypes();
  const availableTypes = types.isError ? [] : types.data;
  const input = (field: EventField) => ({ id: `event-${field}`, name: field, value: values[field], error: errors[field], onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(field, event.target.value) });
  const organization = me.organizations.find((org) => org.id === values.organizerId);
  const unavailable = !!values.organizerId && (!organization?.canPublish || organization.approvalState !== 'APPROVED');
  return <>
    <div className={styles.selectField}>
      <label htmlFor="event-organizerId">От чьего имени (обязательно)</label>
      <select id="event-organizerId" value={values.organizerId} onChange={(event) => change('organizerId', event.target.value)} aria-invalid={!!errors.organizerId} aria-describedby="organizer-hint organizer-error">
        <option value="">От себя — {me.account.displayName}</option>
        {values.organizerId && !organization && <option value={values.organizerId}>Организация из ссылки недоступна</option>}
        {me.organizations.map((org) => <option key={org.id} value={org.id} disabled={!org.canPublish || org.approvalState !== 'APPROVED'}>{org.name}{!org.canPublish || org.approvalState !== 'APPROVED' ? ' — публикация недоступна' : ''}</option>)}
      </select>
      <p id="organizer-hint" className={styles.muted}>От организации можно публиковать после допуска. Личная встреча доступна от твоего имени.</p>
      <p id="organizer-error" className={styles.error}>{errors.organizerId}</p>
      {unavailable && <div className={styles.notice}><p>Выбранная организация сейчас не может публиковать. Личный автор не подставляется автоматически.</p>{organization && <Link to={`/me/organizations/${organization.id}`}>Открыть кабинет организации</Link>}</div>}
    </div>
    <TextField {...input('title')} label="Название встречи" required hint="До 160 символов. Например: «Пробуем петанк в парке»." />
    <fieldset className={styles.choices}>
      <legend>Спортивное направление (обязательно)</legend>
      <div className={styles.choiceRow}>
        <label><input type="radio" name="activityMode" value="list" checked={values.activityMode === 'list'} onChange={() => change('activityMode', 'list')} /> Из списка</label>
        <label><input type="radio" name="activityMode" value="custom" checked={values.activityMode === 'custom'} onChange={() => change('activityMode', 'custom')} /> Своё направление</label>
      </div>
      {values.activityMode === 'list' ? <div className={styles.selectField}>
        <label htmlFor="event-activityId">Выбери направление</label>
        <select id="event-activityId" value={values.activityId} onChange={(event) => { change('activityId', event.target.value); change('activityLabel', availableTypes?.find((item) => item.id === event.target.value)?.name ?? values.activityLabel); }} aria-invalid={!!errors.activityId} aria-describedby="activity-error">
          <option value="">Выбери из списка</option>
          {values.activityId && !availableTypes?.some((item) => item.id === values.activityId) && <option value={values.activityId}>{values.activityLabel || 'Ранее выбранное направление'}</option>}
          {availableTypes?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <p id="activity-error" className={styles.error}>{errors.activityId}</p>
        {types.isPending && <p role="status" className={styles.muted}>Загружаем направления…</p>}
        {types.isError && <p className={styles.notice}>Не удалось загрузить список. Можно указать своё направление.</p>}
        {types.isSuccess && !types.data.length && <p className={styles.muted}>В списке пока нет направлений. Укажи своё.</p>}
        <Button variant="quiet" onClick={() => void types.refetch()} pending={types.isFetching}>Обновить направления</Button>
      </div> : <TextField {...input('activityName')} label="Своё направление" required hint="До 100 символов. Новое направление не задерживает публикацию встречи; включение в общий список проверяется отдельно." />}
    </fieldset>
    <TextAreaField {...input('description')} label="Описание встречи" required hint="Что будете делать и кому подойдёт встреча. До 10 000 символов." />
    <div className={styles.columns}>
      <TextField {...input('localStart')} type="datetime-local" step="60" min="1000-01-01T00:00" max="9999-12-31T23:59" label="Дата и время начала" required hint="Местное время в выбранной ниже зоне встречи." />
      <TextField {...input('timezone')} list="event-timezones" label="Часовая зона встречи" required hint="IANA-зона. Зона устройства не меняет введённое время." autoCapitalize="none" spellCheck={false} />
      <datalist id="event-timezones"><option value="Asia/Krasnoyarsk" /><option value="Europe/Moscow" /><option value="Asia/Novosibirsk" /><option value="Asia/Yekaterinburg" /><option value="Europe/Berlin" /><option value="UTC" /></datalist>
    </div>
    <TextField {...input('city')} label="Город" required autoComplete="address-level2" hint="До 120 символов." />
    <TextAreaField {...input('locationText')} label="Место встречи" required hint="Укажи адрес, точку сбора и ориентир. До 1000 символов." />
  </>;
}

export function ParticipationStep({ values, errors, change }: Pick<StepProps, 'values' | 'errors' | 'change'>) {
  return <>
    <fieldset className={styles.choices} aria-describedby="mode-error">
      <legend>Как люди присоединяются (обязательно)</legend>
      <label className={styles.mode}><input id="event-joinMode" type="radio" name="joinMode" value="OPEN" checked={values.joinMode === 'OPEN'} onChange={() => change('joinMode', 'OPEN')} aria-invalid={!!errors.joinMode} /><span><strong>Свободная запись</strong><span>Человек сразу попадает в подтверждённый состав.</span></span></label>
      <label className={styles.mode}><input type="radio" name="joinMode" value="APPROVAL" checked={values.joinMode === 'APPROVAL'} onChange={() => change('joinMode', 'APPROVAL')} /><span><strong>По заявке</strong><span>Ты принимаешь или отклоняешь заявки. До принятия человек не считается участником.</span></span></label>
      <p id="mode-error" className={styles.error}>{errors.joinMode}</p>
    </fieldset>
    <TextAreaField id="event-conditions" label="Условия участия" value={values.conditions} onChange={(event) => change('conditions', event.target.value)} error={errors.conditions}
      hint="Необязательно. Подготовка, инвентарь и другие условия. До 4000 символов." />
  </>;
}

export function ReviewStep({ values, me, edit }: Pick<StepProps, 'values' | 'me'> & { edit: (field: EventField, step: number) => void }) {
  // Only entered after validation. Rendered text is escaped by React.
  let when = 'Проверь дату и зону встречи.';
  try { when = formatEventStart(eventInput(values)); } catch { /* Stale validation is checked again on publish. */ }
  return <section className={styles.review} aria-label="Сводка встречи">
    <h3>{values.title.trim()}</h3>
    <dl>
      <div><dt>Направление</dt><dd>{values.activityMode === 'custom' ? values.activityName.trim() : values.activityLabel}</dd></div>
      <div><dt>Организатор</dt><dd>{values.organizerId ? me.organizations.find((item) => item.id === values.organizerId)?.name ?? 'Организация недоступна' : me.account.displayName}</dd></div>
      <div><dt>Начало</dt><dd>{when}<span className={styles.muted}>Зона встречи: {values.timezone.trim()}</span></dd></div>
      <div><dt>Город</dt><dd>{values.city.trim()}</dd></div>
      <div><dt>Место</dt><dd>{values.locationText.trim()}</dd></div>
      <div><dt>О встрече</dt><dd>{values.description.trim()}</dd></div>
      <div><dt>Режим записи</dt><dd>{values.joinMode === 'OPEN' ? 'Свободная запись' : values.joinMode === 'APPROVAL' ? 'По заявке' : 'Не выбран'}</dd></div>
      <div><dt>Условия участия</dt><dd>{values.conditions.trim() || 'Дополнительных требований не указано.'}</dd></div>
    </dl>
    <div className={styles.reviewActions} role="group" aria-label="Изменить сведения перед публикацией">
      <Button variant="secondary" onClick={() => edit('title', 0)}>Изменить описание и место</Button>
      <Button variant="secondary" onClick={() => edit('localStart', 0)}>Изменить дату и время</Button>
      <Button variant="secondary" onClick={() => edit('joinMode', 1)}>Изменить участие</Button>
    </div>
    {values.activityMode === 'custom' && <p className={styles.notice}>Своё направление используется сразу. Проверка общего справочника не задерживает встречу.</p>}
    <p className={styles.muted}>После публикации встреча будет доступна другим пользователям. Фон можно будет добавить отдельно.</p>
  </section>;
}
