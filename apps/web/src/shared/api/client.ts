import { createApiClient } from '@ryadom/api-client';
import { reportSessionLoss, sessionEpoch } from './session-boundary';

export const api = createApiClient();
const epochs = new WeakMap<Request, number>();
api.use({
  onRequest({ request }) { epochs.set(request, sessionEpoch()); },
  async onResponse({ request, response }) {
    if (response.status !== 401 && response.status !== 403) return;
    // A rejected new login/register must preserve the previous actor and cache.
    if (new URL(request.url).pathname.startsWith('/api/v1/auth/')) return;
    const payload = await response.clone().json().catch(() => null);
    const code = payload?.error?.code;
    const epoch = epochs.get(request);
    if (epoch === undefined) return;
    if (response.status === 403 && code === 'ACCOUNT_BLOCKED') reportSessionLoss(epoch, 'blocked');
    if (response.status === 401 && (code === 'SESSION_EXPIRED' || code === 'AUTH_REQUIRED')) {
      reportSessionLoss(epoch, code === 'SESSION_EXPIRED' ? 'expired' : null);
    }
  },
});
export type { components, operations, paths } from '@ryadom/api-client';
