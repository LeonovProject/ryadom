import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { TextAreaField } from '../../../shared/ui/Field';
import { firstMeetingQuestions, prepareFirstMeeting, type FirstMeetingAnswers } from './first-meeting';
import styles from './create.module.css';

type Props = {
  answers: FirstMeetingAnswers; conditions: string; needsDecision: boolean; added: boolean;
  change: (field: keyof FirstMeetingAnswers, value: string) => void;
  apply: () => void; discardAndContinue: () => void;
};
export function FirstMeetingHelper({ answers, conditions, needsDecision, added, change, apply, discardAndContinue }: Props) {
  const [open, setOpen] = useState(false);
  const decision = useRef<HTMLDivElement>(null);
  const prepared = prepareFirstMeeting(conditions, answers);
  useEffect(() => { if (needsDecision) { setOpen(true); decision.current?.focus(); } }, [needsDecision]);
  return <section className={styles.helper} aria-label="Помощник условий первой встречи">
    <Button variant="secondary" aria-expanded={open} aria-controls="first-meeting-questions" onClick={() => setOpen(!open)}>
      Что важно знать перед встречей
    </Button>
    <div id="first-meeting-questions" hidden={!open}>
      <div className={styles.helperFields}>
        <p>Помоги тем, кто придёт впервые: расскажи о подготовке, инвентаре и знакомстве. Ответь на нужные вопросы и добавь текст в условия</p>
        {firstMeetingQuestions.map((question) => <TextAreaField key={question.key} id={`first-meeting-${question.key}`}
          label={question.label} value={answers[question.key]} rows={3} placeholder={`Например: «${question.example}»`}
          hint={`Необязательно. До ${question.limit} символов.`} error={prepared.fieldErrors[question.key]}
          onChange={(event) => change(question.key, event.target.value)} />)}
        <section className={styles.notice} aria-label="Предпросмотр добавляемых условий">
          <h3>Будет добавлено в условия</h3>
          <p className={styles.preview}>{prepared.block || 'Ответь на нужные вопросы, чтобы увидеть текст.'}</p>
        </section>
        {!needsDecision && <Button variant="secondary" disabled={!prepared.canApply} onClick={apply}>Добавить в условия</Button>}
      </div>
    </div>
    {prepared.error && <p className={styles.error} role="alert">{prepared.error}</p>}
    {needsDecision && <div className={styles.notice} ref={decision} tabIndex={-1} role="alert">
      <p>Ответы помощника ещё не добавлены в условия</p>
      <div className={styles.actions}>
        <Button variant="secondary" disabled={!prepared.canApply} onClick={apply}>Добавить в условия</Button>
        <Button variant="quiet" onClick={discardAndContinue}>Удалить ответы и продолжить</Button>
      </div>
    </div>}
    {added && <p role="status">Текст добавлен в условия</p>}
  </section>;
}
