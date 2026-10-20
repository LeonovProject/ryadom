import { FormLeavePrompt } from '../../../shared/ui/FormLeavePrompt';

export function LeavePrompt({ open, pending, uncertain, stay, leave }: { open: boolean; pending: boolean; uncertain: boolean; stay: () => void; leave: () => void }) {
  return <FormLeavePrompt open={open} stay={stay} leave={leave} description={pending || uncertain ? 'Публикация могла сохраниться. Уход не отменяет запрос. Перед новой публикацией проверь свои встречи, чтобы не создать дубль.' : 'Введённое хранится только в памяти этой вкладки. При уходе оно будет потеряно.'} />;
}
