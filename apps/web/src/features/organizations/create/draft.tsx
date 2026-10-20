import { useEffect } from 'react';
import { useSession } from '../../auth/SessionProvider';
import type { OrganizationValues } from './validation';
type OrganizationDraft = { ownerId: string; values: OrganizationValues; uncertain: boolean };
let draft: OrganizationDraft | null = null;
export const readOrganizationDraft = (ownerId: string) => draft?.ownerId === ownerId ? structuredClone(draft) : null;
export function saveOrganizationDraft(value: OrganizationDraft) { draft = structuredClone(value); }
export function clearOrganizationDraft() { draft = null; }
export function OrganizationDraftSessionBoundary() {
  const session = useSession();
  useEffect(() => {
    if (session.me && draft && session.me.account.id !== draft.ownerId) clearOrganizationDraft();
    if (session.status === 'guest' && session.notice !== 'expired') clearOrganizationDraft();
  }, [session.status, session.me?.account.id, session.notice]);
  return null;
}
