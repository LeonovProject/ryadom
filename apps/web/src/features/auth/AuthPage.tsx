import { useEffect, useRef, useState, type FormEvent, type ChangeEvent, type ComponentProps } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { sessionEpoch } from '../../shared/api/session-boundary';
import { Avatar } from '../../shared/ui/Avatar';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { TextField } from '../../shared/ui/Field';
import { StatePanel } from '../../shared/ui/StatePanel';
import { AuthFailure, authenticate, unknownFailure } from './api';
import { authLink, safeReturnTo } from './return-to';
import { useSession } from './SessionProvider';
import { usePresets } from './use-presets';
import { LogoutButton } from './LogoutButton';
import { validateAuth, type AuthField, type AuthValues } from './validation';
import { demoAccessEnabled, findDemoAccount, type DemoAccount } from '../demo/demo-access';
import { DemoAccountPicker } from '../demo/DemoAccountPicker';
import styles from './auth.module.css';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const session = useSession();
  const location = useLocation();
  const returnTo = safeReturnTo(new URLSearchParams(location.search).get('returnTo'));
  const [proceed, setProceed] = useState(false);
  return <div className={styles.page}>
    {location.state?.demoResetCompleted === true && <p role="status" className={styles.notice}>Демоданные восстановлены. Войди заново. После входа можно проверить квитанцию в личном профиле.</p>}
    <div className={styles.intro}>
      <p className={styles.eyebrow}>Компания для спорта</p>
      <h1 tabIndex={-1}>{mode === 'register' ? 'Создать профиль' : 'Войти в Рядом'}</h1>
      <p className={styles.muted}>{mode === 'register' ? 'Найди компанию для любимого спорта или собери свою встречу.' : 'Твои встречи и организации — в одном профиле.'}</p>
    </div>
    {session.status === 'loading' || session.logoutPending ? <StatePanel kind="loading" title="Проверяем текущий вход" />
      : session.me ? <section className={styles.card}>
        <h2>Ты уже вошёл</h2>
        <div className={styles.identity}><Avatar name={session.me.account.displayName} url={session.me.account.avatarUrl} /><p>{session.me.account.displayName}</p></div>
        <p className={styles.muted}>Продолжи от текущего аккаунта или сначала выйди, чтобы войти другим.</p>
        <ButtonLink to={returnTo}>Продолжить</ButtonLink>
        <LogoutButton>Выйти и сменить аккаунт</LogoutButton>
      </section>
        : session.status === 'error' && !proceed ? <StatePanel kind="error" title="Не удалось проверить текущий вход"
          action={<><Button onClick={() => void session.refresh()}>Проверить ещё раз</Button><Button variant="secondary" onClick={() => setProceed(true)}>Открыть форму</Button></>}>
          Успешный вход или регистрация заменит текущую сессию этого браузера.
        </StatePanel>
          : <AuthForm key={`${mode}:${sessionEpoch()}`} mode={mode} returnTo={returnTo} />}
  </div>;
}

function AuthForm({ mode, returnTo }: { mode: 'login' | 'register'; returnTo: string }) {
  const register = mode === 'register';
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState<AuthValues>(() => {
    const account = !register && findDemoAccount(location.state?.demoAccount);
    return { displayName: '', email: account ? account.email : '', password: account ? account.password : '', confirmation: '', presetId: '' };
  });
  const [demoNotice, setDemoNotice] = useState('');
  const [touched, setTouched] = useState<Partial<Record<AuthField, boolean>>>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [stalePreset, setStalePreset] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const request = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const summary = useRef<HTMLDivElement>(null);
  const presets = usePresets(register);
  const errors = validateAuth(mode, values);
  const selected = presets.items.find((item) => item.id === values.presetId);
  const unavailablePreset = register && !!values.presetId && (!selected || stalePreset || brokenImages.has(values.presetId));
  const unknown = failure?.code === 'UNKNOWN_RESULT';
  const wait = Math.max(0, Math.ceil((retryUntil - now) / 1000));
  const fieldError = (field: AuthField) => failure?.fields[`/${field}`]?.[0] ?? (touched[field] ? errors[field] : undefined);

  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => {
    if (retryUntil <= Date.now()) return;
    const timer = window.setInterval(() => { const time = Date.now(); setNow(time); if (time >= retryUntil) window.clearInterval(timer); }, 500);
    return () => window.clearInterval(timer);
  }, [retryUntil]);
  useEffect(() => {
    if (!failure) return;
    const field = Object.keys(failure.fields)[0]?.replace(/^\//, '');
    const element = field ? document.getElementById(`${mode}-${field}`) : null;
    (element ?? summary.current)?.focus();
  }, [failure, mode]);

  function change(field: AuthField, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    // Retain uncertainty and rate limits; editing must not enable an automatic replay.
    if (failure && failure.code !== 'UNKNOWN_RESULT' && failure.code !== 'RATE_LIMITED') setFailure(null);
    if (field === 'presetId') setStalePreset(false);
  }
  function selectDemo(account: DemoAccount) {
    if (pending || wait || unknown) return;
    setValues((previous) => ({ ...previous, email: account.email, password: account.password }));
    setTouched({}); setFailure(null);
    setDemoNotice(`Подставлены данные: ${account.name}. Нажми «Войти».`);
    document.getElementById('login-email')?.focus();
  }
  const inputProps = (field: AuthField) => ({
    id: `${mode}-${field}`, name: field, value: values[field], disabled: pending,
    onChange: (event: ChangeEvent<HTMLInputElement>) => change(field, event.target.value),
    onBlur: () => setTouched((previous) => ({ ...previous, [field]: true })), error: fieldError(field),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || pending || wait || unknown || unavailablePreset) return;
    if (Object.keys(errors).length) {
      setTouched({ displayName: true, email: true, password: true, confirmation: true, presetId: true });
      document.getElementById(`${mode}-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    if (register && (presets.status !== 'ready' || !selected)) return;
    lock.current = true;
    setPending(true); setFailure(null);
    const controller = new AbortController();
    request.current = controller;
    const epoch = sessionEpoch();
    try {
      const data = await authenticate(mode, register ? {
        displayName: values.displayName.trim(), email: values.email.trim(), password: values.password, presetId: values.presetId,
      } : { email: values.email.trim(), password: values.password }, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      if (controller.signal.aborted || epoch !== sessionEpoch()) return;
      setValues((previous) => ({ ...previous, password: '', confirmation: '' }));
      session.accept(data);
      navigate(returnTo, { replace: true });
    } catch (error) {
      if (controller.signal.aborted) return;
      const problem = unknownFailure(error);
      setFailure(problem);
      if (problem.retryAfter) { setNow(Date.now()); setRetryUntil(Date.now() + problem.retryAfter * 1000); }
      if (register && problem.fields['/presetId']) { setStalePreset(true); void presets.reload(); }
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return <form onSubmit={submit} noValidate className={styles.card} aria-label={register ? 'Регистрация' : 'Вход'} aria-busy={pending}>
    {!register && demoAccessEnabled && <>
      <DemoAccountPicker onSelect={selectDemo} disabled={pending || wait > 0 || unknown} />
      <p role="status">{demoNotice}</p>
      <Link to={`/demo?returnTo=${encodeURIComponent(returnTo)}`}>Все демоаккаунты и файл для скачивания</Link>
    </>}
    {failure && <div ref={summary} tabIndex={-1} role="alert" className={styles.errorBox}>
      <p>{failure.code === 'INVALID_CREDENTIALS' ? 'Неверный email или пароль.' : failure.code === 'ACCOUNT_BLOCKED' ? 'Аккаунт заблокирован.' : failure.message}</p>
      {unknown && <p>Автоматического повтора нет. {register ? 'Если профиль был создан, войди с указанными email и паролем.' : 'Проверь текущий вход или начни новую попытку вручную.'}</p>}
      {unknown && <div className={styles.actions}><Button variant="secondary" onClick={() => void session.refresh()}>Проверить текущий вход</Button>
        {register ? <Link to={authLink('/login', returnTo)}>Перейти ко входу</Link> : <Button variant="quiet" onClick={() => setFailure(null)}>Новая попытка входа</Button>}
      </div>}
      {failure.code === 'EMAIL_TAKEN' && <Link to={authLink('/login', returnTo)}>Войти с этим email</Link>}
    </div>}
    {wait > 0 && <p className={styles.notice}>Повторная попытка будет доступна через {wait} с. Отправить её нужно вручную.</p>}
    {register && <TextField {...inputProps('displayName')} label="Имя" autoComplete="nickname" required hint="Это имя увидят другие участники." />}
    <TextField {...inputProps('email')} label="Email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required
      hint={register ? 'Email остаётся приватным. Подтверждение почты в этой версии не требуется.' : undefined} />
    <PasswordField {...inputProps('password')} label="Пароль" autoComplete={register ? 'new-password' : 'current-password'} required
      hint={register ? 'От 15 до 128 символов. Пробелы учитываются; вставка и менеджер паролей доступны.' : undefined} />
    {register && <>
      <PasswordField {...inputProps('confirmation')} label="Повтори пароль" autoComplete="new-password" required />
      <fieldset className={styles.presets} disabled={pending}>
        <legend>Выбери готовый аватар (обязательно)</legend>
        <p id="preset-hint" className={styles.muted}>Свой SVG можно загрузить позже в профиле. Даже один готовый вариант нужно выбрать явно.</p>
        {presets.status === 'loading' && <p role="status">Загружаем готовые аватары…</p>}
        {presets.status === 'error' && <StatePanel kind="error" title="Не удалось загрузить аватары" action={<Button variant="secondary" onClick={() => void presets.reload()}>Повторить загрузку</Button>}>Создание профиля пока недоступно. Вход существующим аккаунтом доступен.</StatePanel>}
        {presets.status === 'ready' && !presets.items.length && <StatePanel kind="empty" title="Регистрация пока недоступна: нет готовых аватарок" action={<Button variant="secondary" onClick={() => void presets.reload()}>Обновить каталог</Button>}>Можно войти в уже созданный аккаунт.</StatePanel>}
        {presets.status === 'ready' && !!presets.items.length && <div className={styles.presetGrid}>
          {presets.items.map((item, index) => <label key={item.id} className={styles.preset} data-selected={values.presetId === item.id && !stalePreset}>
            <input id={index === 0 ? `${mode}-presetId` : undefined} type="radio" name="presetId" value={item.id} checked={values.presetId === item.id && !stalePreset}
              aria-describedby="preset-hint preset-error" onChange={() => change('presetId', item.id)} disabled={brokenImages.has(item.id)} />
            <img src={item.imageUrl} alt="" onError={() => setBrokenImages((previous) => new Set(previous).add(item.id))} />
            <span>{item.label}</span>
            {brokenImages.has(item.id) && <span className={styles.error}>Картинка недоступна</span>}
          </label>)}
        </div>}
        {presets.status === 'ready' && !!presets.items.length && <Button variant="quiet" onClick={() => { setBrokenImages(new Set()); void presets.reload(); }}>Обновить готовые аватары</Button>}
        <p id="preset-error" className={styles.error}>{unavailablePreset ? 'Выбранный вариант недоступен. Выбери доступный аватар явно.' : fieldError('presetId')}</p>
        <div className={styles.preview} aria-label="Предпросмотр профиля">
          <Avatar name={values.displayName || 'Имя'} url={selected && !unavailablePreset ? selected.imageUrl : null} large />
          <div><strong>{values.displayName.trim() || 'Твоё имя'}</strong><p className={styles.muted}>{selected && !unavailablePreset ? selected.label : 'Аватар ещё не выбран'}</p></div>
        </div>
      </fieldset>
    </>}
    <Button type="submit" pending={pending} disabled={!!Object.keys(errors).length || wait > 0 || unknown || (register && (presets.status !== 'ready' || !selected || unavailablePreset))}>
      {pending ? register ? 'Создаём профиль…' : 'Входим…' : register ? 'Создать профиль' : 'Войти'}
    </Button>
    <p className={styles.muted}>{register ? 'Уже есть профиль? ' : 'Впервые здесь? '}<Link to={authLink(register ? '/login' : '/register', returnTo)}>{register ? 'Войти' : 'Создать профиль'}</Link></p>
  </form>;
}

function PasswordField(props: ComponentProps<typeof TextField>) {
  const [visible, setVisible] = useState(false);
  return <div className={styles.stack}>
    <TextField {...props} type={visible ? 'text' : 'password'} />
    <Button variant="quiet" disabled={props.disabled} aria-pressed={visible} aria-controls={props.id} onClick={() => setVisible(!visible)}>
      {visible ? 'Скрыть пароль' : 'Показать пароль'}
    </Button>
  </div>;
}
