import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { components } from '../../../shared/api/client';
import { sessionEpoch } from '../../../shared/api/session-boundary';
import { DecisionFailure, decideOrganization, sameId } from './api';

type Organization = components['schemas']['PrivateOrganization'];
type Input = components['schemas']['OrganizationDecisionInput'];
export function useDecision(organization: Organization | undefined, refreshing: boolean, reload: () => Promise<Organization | undefined>) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<DecisionFailure>();
  const [notice, setNotice] = useState<string>();
  const [unknown, setUnknown] = useState(false);
  const [checked, setChecked] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState<{ application: components['schemas']['OrganizationApplication']; input: Input }>();
  const lock = useRef(false);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const client = useQueryClient();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { if (!organization?.application || organization.approvalState !== 'PENDING') setOpen(false); }, [organization?.approvalState, organization?.application?.id]);
  const canDecide = !!organization?.application && organization.approvalState === 'PENDING' && !blocked && !unknown;

  async function send(input: Input, retry = false) {
    const application = retry ? attempt?.application : organization?.application;
    if (lock.current || refreshing || !application || !organization || organization.approvalState !== 'PENDING' || blocked) return;
    if (retry ? !unknown || !checked || !attempt || !sameId(application.id, organization.application?.id ?? '') : !canDecide) return;
    lock.current = true; setPending(true); setFailure(undefined); setNotice(undefined);
    setAttempt({ application, input }); setChecked(false);
    const epoch = sessionEpoch();
    const controller = new AbortController(); request.current = controller;
    try {
      await decideOrganization(application, input, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      if (!mounted.current || epoch !== sessionEpoch()) return;
      setUnknown(false); setBlocked(true); setOpen(false);
      setNotice('Сервер подтвердил решение. Если оно уже было принято с теми же данными, повтор не изменил его. Перечитываем профиль.');
      void client.invalidateQueries({ queryKey: ['admin', epoch, 'organizations'] });
      void client.invalidateQueries({ queryKey: ['private', epoch, 'organizations'] });
      await reload();
    } catch (problem) {
      if (!mounted.current || controller.signal.aborted || epoch !== sessionEpoch()) return;
      const error = problem instanceof DecisionFailure ? problem : new DecisionFailure('UNKNOWN_RESULT');
      setFailure(error);
      if (error.code === 'UNKNOWN_RESULT') {
        setUnknown(true); setOpen(false);
        setNotice('Ответ на решение не получен. Показано текущее состояние заявки; оно не подтверждает выполнение именно этого запроса. Автоматического повтора нет.');
        await reload();
      } else if (error.code === 'DECISION_CONFLICT') {
        setBlocked(true); setOpen(false);
        setNotice('Решение уже принято с другими данными. Оно не изменено. Перечитываем профиль; новое решение автоматически не отправляется.');
        await reload();
      } else if (error.status === 403 || error.status === 404) {
        setBlocked(true); setOpen(false); await reload();
      }
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function check() {
    setChecked(false);
    const epoch = sessionEpoch();
    const current = await reload();
    if (mounted.current && epoch === sessionEpoch()) setChecked(!!current?.application && current.approvalState === 'PENDING' && !!attempt && sameId(current.application.id, attempt.application.id));
  }
  return { pending, failure, notice, unknown, blocked, checked, canDecide, open, setOpen, send, check,
    retry: () => attempt && send(attempt.input, true), attempt };
}
