import { uuid } from '../../../shared/api/operation';
const key = 'ryadom.pending-demo-reset.v1';
// Only a random, non-secret receipt ID. Never store account/session data here.
export function pendingResetId(): string | null {
  try { const id = localStorage.getItem(key); return id && uuid(id) ? id : null; } catch { return null; }
}
export function rememberReset(id: string) {
  localStorage.setItem(key, id);
  if (localStorage.getItem(key) !== id) throw new Error('Receipt storage unavailable');
}
export function forgetReset() { localStorage.removeItem(key); }
