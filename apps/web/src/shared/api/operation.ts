import { ResourceFailure } from './resource-query';
import type { components } from './client';

export class OperationFailure extends ResourceFailure {
  constructor(status: number, readonly code: components['schemas']['Error']['code'] | 'UNKNOWN_RESULT' = 'SERVICE_UNAVAILABLE') { super(status); }
}
export function operationFailure(result: { response: Response; error?: components['schemas']['ErrorResponse'] }) {
  return new OperationFailure(result.response.status, result.error?.error.code);
}
export const requestSignal = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
export const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const sameId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
