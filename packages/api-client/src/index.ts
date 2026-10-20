import createClient from 'openapi-fetch';
import type { paths } from './schema';

// Same-origin cookies; features must not keep their own authentication token.
export function createApiClient(baseUrl = '/api/v1') {
  return createClient<paths>({ baseUrl, credentials: 'same-origin' });
}
export type { paths, components, operations } from './schema';
