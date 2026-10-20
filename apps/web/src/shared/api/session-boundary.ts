export type SessionNotice = 'expired' | 'blocked' | null;
let epoch = 0;
const listeners = new Set<(notice: SessionNotice) => void>();

export const sessionEpoch = () => epoch;
export function advanceSession() { epoch++; }
export function subscribeSession(listener: (notice: SessionNotice) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function reportSessionLoss(requestEpoch: number, notice: SessionNotice) {
  // A response from a previous account must not revoke the newly accepted session.
  if (requestEpoch !== epoch) return;
  for (const listener of listeners) listener(notice);
}
