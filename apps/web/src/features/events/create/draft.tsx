import { useEffect } from 'react';
import { useSession } from '../../auth/SessionProvider';
import type { EventValues } from './validation';

export type EventDraft = { ownerId: string; values: EventValues; step: number; uncertain: boolean };
// A single tab-memory draft, never persisted to storage or sent to another account.
let draft: EventDraft | null = null;
export function readDraft(ownerId: string) { return draft?.ownerId === ownerId ? structuredClone(draft) : null; }
export function saveDraft(value: EventDraft) { draft = structuredClone(value); }
export function clearDraft() { draft = null; }

export function EventDraftSessionBoundary() {
  const session = useSession();
  useEffect(() => {
    if (session.me && draft && session.me.account.id !== draft.ownerId) clearDraft();
    if (session.status === 'guest' && session.notice !== 'expired') clearDraft();
  }, [session.status, session.me?.account.id, session.notice]);
  return null;
}
