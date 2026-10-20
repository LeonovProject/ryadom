import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useBeforeUnload, useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { components } from '../../../shared/api/client';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { Button, ButtonLink } from '../../../shared/ui/Button';
import { PageTitle } from '../../../shared/ui/PageTitle';
import { StatePanel } from '../../../shared/ui/StatePanel';
import { authLink } from '../../auth/return-to';
import { useSession } from '../../auth/SessionProvider';
import { CreateEventFailure, publishEvent } from './api';
import { clearDraft, readDraft, saveDraft } from './draft';
import { BasicsStep, ParticipationStep, ReviewStep } from './EventSteps';
import { FirstMeetingHelper } from './FirstMeetingHelper';
import { emptyFirstMeeting, prepareFirstMeeting, type FirstMeetingAnswers } from './first-meeting';
import { LeavePrompt } from './LeavePrompt';
import { emptyEvent, eventInput, firstStepFields, validateEvent, type EventErrors, type EventField } from './validation';
import styles from './create.module.css';

const stepNames = ['О встрече', 'Участие', 'Проверка'];

export function CreateEventPage() {
  const session = useSession();
  const location = useLocation();
  const target = `${location.pathname}${location.search}`;
  return <div className={styles.page}>
    <div className={styles.intro}><p className={styles.eyebrow}>Собери компанию</p><PageTitle title="Создать встречу" /><p className={styles.muted}>Расскажи, где и когда встречаетесь, и как присоединиться.</p></div>
    {session.status === 'loading' || session.logoutPending ? <StatePanel kind="loading" title="Проверяем вход" />
      : session.status === 'error' ? <StatePanel kind="error" title="Не удалось проверить вход" action={<Button onClick={() => void session.refresh()}>Проверить ещё раз</Button>}>Публикация доступна после подтверждения текущего аккаунта.</StatePanel>
        : !session.me ? <StatePanel kind="unavailable" title={session.notice === 'expired' ? 'Войди снова, чтобы продолжить' : 'Сначала войди в Рядом'}
          action={<><ButtonLink to={authLink('/login', target)}>Войти</ButtonLink><ButtonLink to={authLink('/register', target)} variant="secondary">Создать профиль</ButtonLink></>}>
          {session.notice === 'expired' ? 'Введённое осталось в памяти этой вкладки. Вход в тот же аккаунт вернёт форму; другой аккаунт начнёт с пустой формы. Перезагрузка удалит введённое.' : 'После входа можно создать встречу от себя или своей допущенной организации.'}
        </StatePanel>
          : <CreateEventForm key={`${session.me.account.id}:${location.search}`} me={session.me} organizationId={new URLSearchParams(location.search).get('organization') ?? ''} />}
  </div>;
}

function CreateEventForm({ me, organizationId }: { me: components['schemas']['Me']; organizationId: string }) {
  const [restored] = useState(() => readDraft(me.account.id));
  const [values, setValues] = useState(() => restored?.values ?? emptyEvent(organizationId));
  const [firstMeeting, setFirstMeeting] = useState(() => restored?.firstMeeting ?? emptyFirstMeeting());
  const [helperDecision, setHelperDecision] = useState(false);
  const [helperAdded, setHelperAdded] = useState(false);
  const helperApplied = useRef(false);
  const [step, setStep] = useState(restored?.step ?? 0);
  const [editingReview, setEditingReview] = useState(false);
  const editTarget = useRef<EventField | null>(null);
  const [dirty, setDirty] = useState(!!restored);
  const [uncertain, setUncertain] = useState(restored?.uncertain ?? false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<EventErrors>({});
  const [failure, setFailure] = useState<CreateEventFailure | null>(null);
  const navigate = useNavigate();
  const session = useSession();
  const client = useQueryClient();
  const lock = useRef(false);
  const committed = useRef(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const blocker = useBlocker(useCallback(() => !committed.current && (dirty || lock.current || uncertain), [dirty, uncertain]));
  const localErrors = useMemo(() => validateEvent(values, me.organizations), [values, me.organizations]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { if (dirty && !committed.current) saveDraft({ ownerId: me.account.id, values, step, uncertain, firstMeeting }); }, [dirty, me.account.id, values, step, uncertain, firstMeeting]);
  useBeforeUnload(useCallback((event) => { if (!committed.current && (dirty || lock.current || uncertain)) { event.preventDefault(); event.returnValue = ''; } }, [dirty, uncertain]));
  const previousStep = useRef(step);
  useLayoutEffect(() => {
    if (previousStep.current !== step) {
      const field = editTarget.current && document.getElementById(`event-${editTarget.current}`);
      (field || heading.current)?.focus();
      editTarget.current = null;
    }
    previousStep.current = step;
  }, [step]);
  useEffect(() => {
    const first = Object.keys(errors)[0];
    if (first) document.getElementById(`event-${first}`)?.focus();
    else if (failure) summary.current?.focus();
  }, [errors, failure, step]);

  function change(field: EventField, value: string) {
    if (pending || uncertain) return;
    setValues((previous) => ({ ...previous, [field]: value }));
    setDirty(true); setErrors({}); setFailure(null);
  }
  function changeHelper(field: keyof FirstMeetingAnswers, value: string) {
    if (lock.current || uncertain) return;
    helperApplied.current = false;
    setFirstMeeting((previous) => ({ ...previous, [field]: value }));
    setDirty(true); setHelperAdded(false); setHelperDecision(false);
  }
  function applyHelper() {
    if (lock.current || uncertain || helperApplied.current) return;
    const prepared = prepareFirstMeeting(values.conditions, firstMeeting);
    if (!prepared.canApply) return;
    helperApplied.current = true;
    change('conditions', prepared.result);
    setFirstMeeting(emptyFirstMeeting()); setHelperDecision(false); setHelperAdded(true);
    document.getElementById('event-conditions')?.focus();
  }
  function discardHelperAndContinue() {
    if (lock.current || uncertain) return;
    setFirstMeeting(emptyFirstMeeting()); setHelperDecision(false); setHelperAdded(false); setDirty(true);
    void continueForm(true);
  }
  function editReview(field: EventField, targetStep: number) {
    if (lock.current || uncertain) return;
    editTarget.current = field;
    setErrors({}); setFailure(null); setEditingReview(true); setStep(targetStep);
  }
  function showErrors(next: EventErrors) {
    setErrors(next);
    if (Object.keys(next).some((field) => firstStepFields.includes(field as EventField))) setStep(0);
    else setStep(1);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    await continueForm();
  }
  async function continueForm(discardHelper = false) {
    if (lock.current || uncertain) return;
    if ((step > 0 || editingReview) && !discardHelper && prepareFirstMeeting(values.conditions, firstMeeting).block) {
      setHelperDecision(true); setStep(1); return;
    }
    const current = validateEvent(values, me.organizations);
    const relevant = editingReview ? current : step === 0 ? Object.fromEntries(Object.entries(current).filter(([field]) => firstStepFields.includes(field as EventField))) : step === 1 ? Object.fromEntries(Object.entries(current).filter(([field]) => !firstStepFields.includes(field as EventField))) : current;
    if (Object.keys(relevant).length) { showErrors(relevant); return; }
    if (step < 2) { setErrors({}); setStep(editingReview ? 2 : step + 1); setEditingReview(false); return; }
    lock.current = true; setPending(true); setFailure(null); setErrors({});
    // Persist uncertainty before dispatch: losing a session/unmounting cannot re-enable POST.
    saveDraft({ ownerId: me.account.id, values, step, uncertain: true, firstMeeting });
    const controller = new AbortController(); request.current = controller;
    const epoch = sessionEpoch();
    try {
      const result = await publishEvent(eventInput(values), AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      if (!mounted.current || epoch !== sessionEpoch()) return;
      committed.current = true; clearDraft();
      // The canonical page re-reads actual permissions and publication after navigation.
      void client.invalidateQueries({ queryKey: ['public', 'events'] });
      void client.invalidateQueries({ queryKey: ['public', 'activity-types'] });
      navigate(`/events/${result.id}`, { replace: true });
    } catch (problem) {
      if (!mounted.current || controller.signal.aborted || epoch !== sessionEpoch()) return;
      const error = problem instanceof CreateEventFailure ? problem : new CreateEventFailure('UNKNOWN_RESULT');
      if (values.activityMode === 'custom' && error.fields.activityId) { error.fields.activityName = error.fields.activityId; delete error.fields.activityId; }
      setFailure(error);
      const unknown = error.code === 'UNKNOWN_RESULT';
      setUncertain(unknown);
      saveDraft({ ownerId: me.account.id, values, step, uncertain: unknown, firstMeeting });
      if (Object.keys(error.fields).length) showErrors(error.fields);
      if (error.code === 'ORG_NOT_APPROVED' || error.code === 'NOT_FOUND') { setStep(0); void session.refresh(); }
    } finally {
      lock.current = false;
      if (mounted.current && !controller.signal.aborted) setPending(false);
    }
  }

  return <>
    <ol className={styles.steps} aria-label="Шаги создания встречи">{stepNames.map((name, index) => <li key={name} aria-current={index === step ? 'step' : undefined}><span>{index + 1}</span>{name}</li>)}</ol>
    {restored && <p className={styles.notice}>Форма восстановлена из памяти этой вкладки. Она не сохранена на сервере.</p>}
    <form className={styles.card} noValidate onSubmit={submit} aria-label="Создание встречи" aria-busy={pending}>
      <h2 ref={heading} tabIndex={-1}>{stepNames[step]}</h2>
      {failure && <div ref={summary} className={styles.errorBox} role="alert" tabIndex={-1}>
        <p>{failure.code === 'UNKNOWN_RESULT' ? 'Результат публикации неизвестен. Запрос мог сохраниться, но подтверждение не получено.'
          : failure.code === 'ORG_NOT_APPROVED' ? 'Допуск организации изменился. Проверь автора встречи.'
            : failure.code === 'NOT_FOUND' ? 'Выбранный автор или направление недоступны. Проверь форму.'
              : failure.code === 'CSRF_REJECTED' ? 'Сервер не принял запрос с этой страницы. Проверь текущий вход перед новой попыткой.'
                : 'Не удалось опубликовать встречу. Проверь указанные поля и попробуй снова.'}</p>
      </div>}
      {uncertain && <div className={styles.notice} role="status"><p>Повторная отправка заблокирована, чтобы не создать дубль. Сначала проверь свои встречи. Совпадение названия не подтверждает результат этого запроса.</p><Link to="/me/events?tab=created">Перейти к моим встречам</Link><p>Перезагрузка удалит форму из памяти и не отменит возможную публикацию.</p></div>}
      <fieldset className={styles.fields} disabled={pending || uncertain}>
        {step === 0 ? <BasicsStep values={values} errors={errors} change={change} me={me} /> : step === 1 ? <><ParticipationStep values={values} errors={errors} change={change} />
          <FirstMeetingHelper answers={firstMeeting} conditions={values.conditions} needsDecision={helperDecision} added={helperAdded}
            change={changeHelper} apply={applyHelper} discardAndContinue={discardHelperAndContinue} /></> : <ReviewStep values={values} me={me} edit={editReview} />}
      </fieldset>
      {step === 2 && Object.keys(localErrors).length > 0 && <p className={styles.notice}>Сведения изменились или время уже прошло. При публикации нужно будет проверить форму.</p>}
      <div className={styles.actions}>
        {step > 0 && <Button variant="secondary" disabled={pending || uncertain} onClick={() => { setErrors({}); setStep(step - 1); }}>Назад</Button>}
        <Button type="submit" pending={pending} disabled={uncertain}>{pending ? 'Публикуем…' : step === 2 ? 'Опубликовать встречу' : editingReview ? 'Вернуться к проверке' : step === 0 ? 'Далее: участие' : 'Проверить встречу'}</Button>
      </div>
      <p className={styles.muted}>Черновик хранится только в памяти вкладки. После перезагрузки его не будет.</p>
    </form>
    <Link to="/events">Выйти к встречам</Link>
    <LeavePrompt open={blocker.state === 'blocked'} pending={pending} uncertain={uncertain} stay={() => blocker.state === 'blocked' && blocker.reset()} leave={() => { if (blocker.state === 'blocked') { clearDraft(); blocker.proceed(); } }} />
  </>;
}
