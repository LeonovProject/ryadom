export type FirstMeetingAnswers = { preparation: string; equipment: string; recognition: string; welcome: string };
export const firstMeetingQuestions = [
  { key: 'preparation', label: 'Какая подготовка нужна и какой будет темп?', prefix: 'Подготовка и темп', limit: 600, example: 'Начальный уровень, спокойный темп' },
  { key: 'equipment', label: 'Что взять с собой?', prefix: 'Что взять с собой', limit: 600, example: 'Вода и удобная обувь; коврик предоставим' },
  { key: 'recognition', label: 'Как узнать организатора на месте?', prefix: 'Как узнать организатора', limit: 400, example: 'Анна с красной лентой на рюкзаке' },
  { key: 'welcome', label: 'Что будет в начале встречи?', prefix: 'В начале встречи', limit: 600, example: 'Познакомимся и объясним упражнения' },
] as const;
export function emptyFirstMeeting(): FirstMeetingAnswers {
  return { preparation: '', equipment: '', recognition: '', welcome: '' };
}

// Plain text only. Preserve the author's conditions and internal answer whitespace.
export function prepareFirstMeeting(conditions: string, answers: FirstMeetingAnswers) {
  const fieldErrors: Partial<Record<keyof FirstMeetingAnswers, string>> = {};
  const lines: string[] = [];
  for (const question of firstMeetingQuestions) {
    const answer = answers[question.key].trim();
    if ([...answer].length > question.limit) fieldErrors[question.key] = `Не больше ${question.limit} символов.`;
    if (answer) lines.push(`${question.prefix}: ${answer}`);
  }
  const block = lines.join('\n');
  const result = block ? (conditions.trim() ? `${conditions}\n\n${block}` : block) : conditions;
  const length = [...result].length;
  const error = block && length > 4000 ? `В условиях получится ${length} символов из 4000. Сократи текст перед добавлением` : undefined;
  return { block, result, fieldErrors, error, canApply: !!block && !error && !Object.keys(fieldErrors).length };
}
