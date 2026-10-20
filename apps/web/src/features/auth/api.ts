import { api, type components } from '../../shared/api/client';

export class AuthFailure extends Error {
  constructor(
    message: string,
    readonly code: components['schemas']['Error']['code'] | 'UNKNOWN_RESULT',
    readonly fields: Record<string, string[]> = {},
    readonly retryAfter = 0,
  ) { super(message); }
}

export function responseFailure(response: Response, payload?: components['schemas']['ErrorResponse']): AuthFailure {
  if (response.status >= 500) return new AuthFailure('Не удалось подтвердить результат. Сервер временно недоступен.', 'UNKNOWN_RESULT');
  const error = payload?.error;
  const seconds = Number(response.headers.get('Retry-After'));
  return new AuthFailure(
    error?.message ?? 'Не удалось выполнить запрос. Попробуй позже.',
    error?.code ?? 'UNKNOWN_RESULT', error?.fieldErrors ?? {},
    response.status === 429 ? Math.max(1, Number.isFinite(seconds) && seconds > 0 ? seconds : 60) : 0,
  );
}

export async function authenticate(mode: 'login' | 'register', input: components['schemas']['RegisterInput'] | components['schemas']['LoginInput'], signal: AbortSignal) {
  // Credentials never enter the Query/Mutation cache. Each action sends exactly one POST.
  const result = mode === 'register'
    ? await api.POST('/auth/register', { body: input as components['schemas']['RegisterInput'], signal })
    : await api.POST('/auth/login', { body: input, signal });
  if (result.response.status !== (mode === 'register' ? 201 : 200) || !result.data) {
    throw responseFailure(result.response, result.error);
  }
  return result.data;
}

export function unknownFailure(error: unknown) {
  return error instanceof AuthFailure ? error : new AuthFailure('Ответ не получен. Результат операции неизвестен.', 'UNKNOWN_RESULT');
}
