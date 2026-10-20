import { describe, expect, it } from 'vitest';
import type { components } from '../../../../shared/api/client';
import { emptyEvent, eventInput, serverFieldErrors, validateEvent } from '../validation';

const now = Date.parse('2026-10-20T00:00:00Z');
const id = '00000003-0000-4000-8000-000000000001';
const approved: components['schemas']['OwnedOrganizationRef'] = { id, name: 'Клуб', approvalState: 'APPROVED', canPublish: true };
const valid = () => ({ ...emptyEvent(), title: 'Петанк', description: 'Попробуем вместе', activityMode: 'custom' as const, activityName: 'Петанк', localStart: '2026-11-07T01:00', city: 'Красноярск', locationText: 'В парке', joinMode: 'OPEN' as const });

describe('create event validation', () => {
  it('produces one typed request with explicit discriminators and no draft-only fields', () => {
    const values = { ...valid(), title: ' Петанк ', organizerId: id, activityName: ' Новое направление ' };
    expect(validateEvent(values, [approved], now)).toEqual({});
    expect(eventInput(values)).toEqual({ organizer: { type: 'ORGANIZATION', organizationId: id }, activityType: { name: 'Новое направление' }, title: 'Петанк', description: 'Попробуем вместе', startsAt: '2026-11-06T18:00:00.000Z', timezone: 'Asia/Krasnoyarsk', city: 'Красноярск', locationText: 'В парке', conditions: '', joinMode: 'OPEN' });
  });
  it('uses the ID of a previously chosen direction without assigning a catalogue status', () => {
    const values = { ...valid(), activityMode: 'list' as const, activityId: id, activityLabel: 'Петанк' };
    expect(validateEvent(values, [], now)).toEqual({});
    expect(eventInput(values).activityType).toEqual({ id });
    expect(eventInput(values).organizer).toEqual({ type: 'PERSONAL' });
  });
  it.each(['NOT_SUBMITTED', 'PENDING', 'REJECTED'] as const)('blocks %s organization without changing the chosen author', (approvalState) => {
    const values = { ...valid(), organizerId: id };
    expect(validateEvent(values, [{ ...approved, approvalState, canPublish: false }], now).organizerId).toBeTruthy();
    expect(values.organizerId).toBe(id);
  });
  it('blocks missing organizations and inconsistent capabilities', () => {
    const values = { ...valid(), organizerId: id };
    expect(validateEvent(values, [], now).organizerId).toBeTruthy();
    expect(validateEvent(values, [{ ...approved, canPublish: false }], now).organizerId).toBeTruthy();
  });
  it('requires fields but permits empty conditions', () => {
    expect(Object.keys(validateEvent(emptyEvent(), [], now))).toEqual(expect.arrayContaining(['title', 'description', 'activityId', 'localStart', 'city', 'locationText', 'joinMode']));
    expect(validateEvent(valid(), [], now).conditions).toBeUndefined();
  });
  it('counts Unicode characters and enforces text limits', () => {
    expect(validateEvent({ ...valid(), title: '🎾'.repeat(160) }, [], now).title).toBeUndefined();
    expect(validateEvent({ ...valid(), title: '🎾'.repeat(161), activityName: 'x'.repeat(101), conditions: 'x'.repeat(4001) }, [], now)).toMatchObject({ title: expect.any(String), activityName: expect.any(String), conditions: expect.any(String) });
  });
  it('rejects the exact start boundary and past starts', () => {
    const values = valid();
    const start = Date.parse(eventInput(values).startsAt);
    expect(validateEvent(values, [], start - 1).localStart).toBeUndefined();
    expect(validateEvent(values, [], start).localStart).toBeTruthy();
    expect(validateEvent(values, [], start + 1).localStart).toBeTruthy();
  });
  it('maps server JSON pointers to the matching form fields', () => {
    expect(serverFieldErrors({ '/startsAt': ['Будущее время'], '/organizer/organizationId': ['Нет допуска'], '/activityType/name': ['Слишком длинное'], '/internal': ['ignore'] })).toEqual({ localStart: 'Будущее время', organizerId: 'Нет допуска', activityName: 'Слишком длинное' });
  });
});
