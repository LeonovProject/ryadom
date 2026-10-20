import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useBeforeUnload, useBlocker, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { Button } from '../../../shared/ui/Button';
import { FormLeavePrompt } from '../../../shared/ui/FormLeavePrompt';
import { TextAreaField, TextField } from '../../../shared/ui/Field';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { OrganizationGate } from '../private/OrganizationGate';
import { createOrganization, OrganizationWriteFailure } from '../private/api';
import { clearOrganizationDraft, readOrganizationDraft, saveOrganizationDraft } from './draft';
import { emptyOrganization, organizationFieldErrors, organizationInput, validateOrganization, type OrganizationErrors, type OrganizationField } from './validation';
import styles from '../private/organizations.module.css';

export function CreateOrganizationPage() {
  return <div className={`${styles.page} ${styles.form}`}>
    <div className={styles.intro}><p className={styles.eyebrow}>Клубы и сообщества</p><PageTitle title="Создать организацию" /><p className={styles.muted}>Расскажи об объединении. Сначала сохраним закрытый профиль, затем можно отдельно отправить заявку на допуск.</p></div>
    <OrganizationGate restore>{(me) => <OrganizationForm key={me.account.id} ownerId={me.account.id} />}</OrganizationGate>
  </div>;
}
function OrganizationForm({ ownerId }: { ownerId: string }) {
  const [restored] = useState(() => readOrganizationDraft(ownerId));
  const [values, setValues] = useState(restored?.values ?? emptyOrganization());
  const [dirty, setDirty] = useState(!!restored);
  const [unknown, setUnknown] = useState(restored?.uncertain ?? false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<OrganizationErrors>({});
  const [failure, setFailure] = useState<OrganizationWriteFailure | null>(null);
  const navigate = useNavigate();
  const client = useQueryClient();
  const lock = useRef(false);
  const committed = useRef(false);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  const blocker = useBlocker(useCallback(() => !committed.current && (dirty || unknown || lock.current), [dirty, unknown]));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { if (dirty && !committed.current) saveOrganizationDraft({ ownerId, values, uncertain: unknown }); }, [dirty, ownerId, values, unknown]);
  useBeforeUnload(useCallback((event) => { if (!committed.current && (dirty || unknown || lock.current)) { event.preventDefault(); event.returnValue = ''; } }, [dirty, unknown]));
  useEffect(() => {
    const first = Object.keys(errors)[0];
    if (first) document.getElementById(`organization-${first}`)?.focus();
    else if (failure || unknown) summary.current?.focus();
  }, [errors, failure, unknown]);
  function change(field: OrganizationField, value: string) {
    if (pending || unknown) return;
    setValues((previous) => ({ ...previous, [field]: value })); setDirty(true); setErrors({}); setFailure(null);
  }
  const input = (field: OrganizationField) => ({ id: `organization-${field}`, name: field, value: values[field], error: errors[field], onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(field, event.target.value) });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || unknown) return;
    const problems = validateOrganization(values);
    if (Object.keys(problems).length) { setErrors(problems); return; }
    lock.current = true; setPending(true); setFailure(null); setErrors({});
    saveOrganizationDraft({ ownerId, values, uncertain: true });
    const controller = new AbortController(); request.current = controller;
    const epoch = sessionEpoch();
    try {
      const organization = await createOrganization(organizationInput(values), ownerId, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      if (!mounted.current || epoch !== sessionEpoch()) return;
      committed.current = true; clearOrganizationDraft();
      void client.invalidateQueries({ queryKey: ['private', epoch, 'organizations'] });
      navigate(`/me/organizations/${organization.id}`, { replace: true });
    } catch (problem) {
      if (!mounted.current || controller.signal.aborted || epoch !== sessionEpoch()) return;
      const error = problem instanceof OrganizationWriteFailure ? problem : new OrganizationWriteFailure('UNKNOWN_RESULT');
      const uncertain = error.code === 'UNKNOWN_RESULT';
      setFailure(error); setUnknown(uncertain); setErrors(organizationFieldErrors(error.fields));
      saveOrganizationDraft({ ownerId, values, uncertain });
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return <>
    {restored && <p className={styles.notice}>Форма восстановлена из памяти вкладки. На сервере этот черновик не сохранён.</p>}
    <form noValidate onSubmit={submit} className={styles.card} aria-label="Создание организации" aria-busy={pending}>
      {(failure || unknown) && <div ref={summary} tabIndex={-1} role="alert" className={unknown ? styles.notice : styles.error}>
        <p>{unknown ? 'Результат создания неизвестен. Профиль мог сохраниться. Повторная отправка заблокирована, чтобы не создать дубль.' : failure?.code === 'CSRF_REJECTED' ? 'Сервер не принял запрос с этой страницы. Проверь текущий вход.' : 'Не удалось создать профиль. Проверь поля и попробуй позже.'}</p>
        {unknown && <><p>Сначала проверь свои организации. Совпадение названия не подтверждает выполнение именно этого запроса.</p><Link to="/me/organizations">Проверить свои организации</Link></>}
      </div>}
      <fieldset className={styles.fields} disabled={pending || unknown}>
        <TextField {...input('name')} label="Название организации" required hint="До 160 символов. Например, название клуба или сообщества." />
        <TextAreaField {...input('description')} label="Деятельность" required hint="Чем занимается ваше объединение и для кого оно. До 4000 символов." />
        <TextAreaField {...input('sportInterests')} label="Спортивные интересы" required hint="Виды спорта и активности, которые вас объединяют. До 2000 символов." />
      </fieldset>
      <p className={styles.muted}>Создание профиля не публикует организацию и не отправляет заявку автоматически.</p>
      <Button type="submit" pending={pending} disabled={unknown}>{pending ? 'Создаём профиль…' : 'Создать профиль организации'}</Button>
      <p className={styles.muted}>Введённое хранится только в памяти вкладки. Перезагрузка удалит его.</p>
    </form>
    <Link to="/me/organizations">Вернуться к своим организациям</Link>
    <FormLeavePrompt open={blocker.state === 'blocked'} description={pending || unknown ? 'Профиль мог сохраниться. Уход не отменяет запрос. Перед новой попыткой проверь свои организации, чтобы не создать дубль.' : 'Введённое хранится только в памяти вкладки. При уходе оно будет потеряно.'} stay={() => blocker.state === 'blocked' && blocker.reset()} leave={() => { if (blocker.state === 'blocked') { clearOrganizationDraft(); blocker.proceed(); } }} />
  </>;
}
