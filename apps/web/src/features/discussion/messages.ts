import type { components } from '../../shared/api/client';
type Message = components['schemas']['PublicMessage'];
export function orderedMessages(pages: components['schemas']['MessagePage'][]) {
  const items = new Map<string, Message>();
  // The newest page wins if an older page contains the same ID (possibly moderated).
  for (const page of [...pages].reverse()) for (const item of page.items) items.set(item.id.toLowerCase(), item);
  return [...items.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id.toLowerCase() < b.id.toLowerCase() ? -1 : a.id.toLowerCase() > b.id.toLowerCase() ? 1 : 0));
}
