export type AuthValues = { displayName: string; email: string; password: string; confirmation: string; presetId: string };
export type AuthField = keyof AuthValues;

export function validateAuth(mode: 'login' | 'register', values: AuthValues): Partial<Record<AuthField, string>> {
  const errors: Partial<Record<AuthField, string>> = {};
  const email = values.email.trim();
  if (email.length < 3 || email.length > 254 || /[^\x21-\x7e]/.test(email) || !/^[^@\s]+@[^@\s]+$/.test(email)) errors.email = 'Укажи корректный email без пробелов.';
  const length = Array.from(values.password).length;
  if (length < (mode === 'register' ? 15 : 1) || length > 128) errors.password = mode === 'register' ? 'Пароль должен содержать от 15 до 128 символов.' : 'Введи пароль длиной до 128 символов.';
  if (mode === 'register') {
    const nameLength = Array.from(values.displayName.trim()).length;
    if (nameLength < 1 || nameLength > 120) errors.displayName = 'Укажи имя длиной от 1 до 120 символов.';
    if (values.confirmation !== values.password) errors.confirmation = 'Пароли не совпадают.';
    if (!values.presetId) errors.presetId = 'Выберите аватар.';
  }
  return errors;
}
