type Draft = { eventId: string; ownerId: string | null; body: string; uncertain: boolean };
let draft: Draft | null = null;
export function readMessageDraft(eventId: string, ownerId: string | null) {
  if (draft?.ownerId && draft.ownerId !== ownerId) draft = null;
  if (draft?.eventId !== eventId) return { body: '', uncertain: false };
  // A guest's text can continue after explicit login, never auto-send.
  draft.ownerId = ownerId;
  return { body: draft.body, uncertain: draft.uncertain };
}
export function saveMessageDraft(value: Draft) { draft = { ...value }; }
export function clearMessageDraft() { draft = null; }
