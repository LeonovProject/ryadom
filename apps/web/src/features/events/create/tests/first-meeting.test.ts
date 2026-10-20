import { describe, expect, it } from 'vitest';
import { emptyFirstMeeting, firstMeetingQuestions, prepareFirstMeeting } from '../first-meeting';
import { clearDraft, readDraft, saveDraft } from '../draft';
import { emptyEvent } from '../validation';

describe('first meeting plain text', () => {
  it('preserves manual text, fixed order, inner whitespace and literal markup', () => {
    const result = prepareFirstMeeting('Ручные условия.\n', {
      preparation: '  Без опыта\n  Спокойный темп  ', equipment: 'Вода',
      recognition: '<b>Анна</b>', welcome: '  Познакомимся  ',
    });
    expect(result.canApply).toBe(true);
    expect(result.result).toBe('Ручные условия.\n\n\nПодготовка и темп: Без опыта\n  Спокойный темп\nЧто взять с собой: Вода\nКак узнать организатора: <b>Анна</b>\nВ начале встречи: Познакомимся');
  });
  it('omits blank answers and never supplies placeholder values', () => {
    expect(prepareFirstMeeting('Вручную', emptyFirstMeeting())).toMatchObject({ block: '', result: 'Вручную', canApply: false });
    expect(prepareFirstMeeting('  ', { ...emptyFirstMeeting(), equipment: ' Вода ', welcome: '\n ' }).result).toBe('Что взять с собой: Вода');
  });
  it.each(firstMeetingQuestions)('enforces $key code point limit without truncation', ({ key, limit }) => {
    const answers = { ...emptyFirstMeeting(), [key]: '🎾'.repeat(limit) };
    expect(prepareFirstMeeting('', answers).canApply).toBe(true);
    answers[key] += '🎾';
    const result = prepareFirstMeeting('', answers);
    expect(result.fieldErrors[key]).toBe(`Не больше ${limit} символов.`);
    expect(result.canApply).toBe(false);
    expect(result.block).toContain(answers[key]);
  });
  it.each([3999, 4000, 4001])('checks the entire appended conditions at %i code points', (length) => {
    const answers = { ...emptyFirstMeeting(), equipment: 'Вода\n🎾' };
    const block = prepareFirstMeeting('', answers).block;
    const manual = '🎾'.repeat(length - [...block].length - 2);
    const result = prepareFirstMeeting(manual, answers);
    expect([...result.result]).toHaveLength(length);
    expect(result.canApply).toBe(length <= 4000);
    expect(result.error).toBe(length > 4000 ? `В условиях получится ${length} символов из 4000. Сократи текст перед добавлением` : undefined);
    expect(result.result).toBe(`${manual}\n\n${block}`);
  });
  it('keeps the optional helper outside values; reads old drafts and isolates owners', () => {
    const old = { ownerId: 'one', values: emptyEvent(), step: 1, uncertain: false };
    saveDraft(old);
    expect(readDraft('one')?.firstMeeting ?? emptyFirstMeeting()).toEqual(emptyFirstMeeting());
    saveDraft({ ...old, firstMeeting: { ...emptyFirstMeeting(), equipment: 'Вода' } });
    const restored = readDraft('one')!;
    expect(restored.firstMeeting?.equipment).toBe('Вода');
    expect(restored.values).not.toHaveProperty('firstMeeting');
    restored.firstMeeting!.equipment = 'Изменено';
    expect(readDraft('one')?.firstMeeting?.equipment).toBe('Вода');
    expect(readDraft('two')).toBeNull();
    clearDraft(); expect(readDraft('one')).toBeNull();
  });
});
