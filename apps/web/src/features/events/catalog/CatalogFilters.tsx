import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../../shared/ui/Button';
import { TextField } from '../../../shared/ui/Field';
import { applyDraft, draftFromSearch } from './filters';
import { useActivityTypes } from './queries';
import styles from './catalog.module.css';

export function CatalogFilters({ search, defaultFrom, onApply, onReset }: { search: string; defaultFrom: string; onApply: (search: string) => void; onReset: () => void }) {
  const [draft, setDraft] = useState(() => draftFromSearch(search));
  const [expanded, setExpanded] = useState(() => hasAdvancedFilters(search));
  const [error, setError] = useState<string | null>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const types = useActivityTypes();
  useEffect(() => { setDraft(draftFromSearch(search)); setError(null); if (hasAdvancedFilters(search)) setExpanded(true); }, [search]);
  useEffect(() => { if (error) summary.current?.focus(); }, [error]);
  const update = (key: keyof typeof draft, value: string) => { setDraft((previous) => ({ ...previous, [key]: value })); setError(null); };
  const availableTypes = types.isError ? [] : types.data;
  const knownType = availableTypes?.some((item) => item.id.toLowerCase() === draft.activityTypeId.toLowerCase());
  const selectedType = availableTypes?.find((item) => item.id.toLowerCase() === draft.activityTypeId.toLowerCase());
  const source = new URLSearchParams(search);
  const openDateRange = source.has('dateFrom') && !source.has('dateTo') && draft.firstDay === source.get('dateFrom') && !draft.lastDay;
  function submit(event: FormEvent) {
    event.preventDefault();
    try { onApply(applyDraft(search, draft, defaultFrom)); } catch (problem) { setError(problem instanceof Error ? problem.message : 'Проверь фильтры.'); }
  }
  return <form className={styles.filterForm} onSubmit={submit} aria-label="Поиск встреч" noValidate>
    <div className={styles.searchRow}>
      <TextField label="Что интересно?" name="q" type="search" placeholder="Спорт или название встречи" value={draft.q} onChange={(event) => update('q', event.target.value)} />
      <TextField label="Город" name="city" placeholder="Все города" value={draft.city} onChange={(event) => update('city', event.target.value)} />
      <Button type="submit">Найти встречи</Button>
    </div>
    <Button className={styles.filterToggle} variant="secondary" aria-expanded={expanded} aria-controls={`${id}-filters`} onClick={() => setExpanded(!expanded)}>Фильтры</Button>
    <div id={`${id}-filters`} className={styles.moreFilters} data-expanded={expanded}>
      <div className={styles.selectField}>
        <label htmlFor={`${id}-activity`}>Направление</label>
        <select id={`${id}-activity`} name="activityTypeId" value={selectedType?.id ?? draft.activityTypeId} onChange={(event) => update('activityTypeId', event.target.value)}>
          <option value="">Любое направление</option>
          {draft.activityTypeId && !knownType && <option value={draft.activityTypeId}>Направление из ссылки</option>}
          {availableTypes?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {types.isPending && <p role="status" className={styles.caption}>Загружаем направления…</p>}
        {types.isError && <div className={styles.inlineError}><p>Не удалось загрузить направления. Другие фильтры доступны.</p><Button variant="quiet" onClick={() => void types.refetch()}>Повторить загрузку направлений</Button></div>}
        {types.isSuccess && !types.data.length && <p className={styles.caption}>В списке пока нет направлений. Можно искать по названию.</p>}
      </div>
      <div className={styles.selectField}>
        <label htmlFor={`${id}-mode`}>Режим записи</label>
        <select id={`${id}-mode`} name="joinMode" value={draft.joinMode} onChange={(event) => update('joinMode', event.target.value)}>
          <option value="">Любой режим</option><option value="OPEN">Свободная запись</option><option value="APPROVAL">По заявке</option>
        </select>
      </div>
      <fieldset className={styles.dateRange}>
        <legend>По местной дате встречи</legend>
        <div className={styles.dateInputs}>
          <TextField label="Первый день" name="firstDay" type="date" value={draft.firstDay} onChange={(event) => update('firstDay', event.target.value)} />
          <TextField label="Последний день включительно" name="lastDay" type="date" value={draft.lastDay} onChange={(event) => update('lastDay', event.target.value)} />
        </div>
        <p className={styles.caption}>{openDateRange ? 'В ссылке выбраны встречи начиная с первого дня, без последнего. Для поиска за один день укажи ту же дату последней.' : 'Если указан только первый день, ищем встречи за этот день.'} Дата определяется зоной каждой встречи.</p>
      </fieldset>
    </div>
    {error && <p ref={summary} role="alert" tabIndex={-1} className={styles.inlineError}>{error}</p>}
    <div className={styles.filterActions}><Button type="submit" variant="secondary">Применить фильтры</Button><Button variant="quiet" onClick={onReset}>Сбросить фильтры</Button></div>
  </form>;
}

function hasAdvancedFilters(search: string) {
  const params = new URLSearchParams(search);
  return ['activityTypeId', 'joinMode', 'dateFrom', 'dateTo'].some((key) => params.has(key));
}
