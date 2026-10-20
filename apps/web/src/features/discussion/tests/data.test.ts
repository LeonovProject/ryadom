import { describe, expect, it } from 'vitest';
import { orderedMessages } from '../messages';
import { clearMessageDraft, readMessageDraft, saveMessageDraft } from '../draft';
import { nextLocalDay } from '../../participation/home/time';
import type { components } from '../../../shared/api/client';

describe('FE-P2 data boundaries', () => {
  it('keeps newest moderation state and orders earlier pages without duplicate IDs', () => {
    const visible: components['schemas']['VisibleMessage'] = { id: 'a', eventId: 'event', author: { id: 'person', displayName: 'Имя', isBlocked: false, avatarUrl: null }, authorIsOrganizer: false, createdAt: '2026-11-01T09:00:00Z', status: 'VISIBLE', body: 'Старый текст' };
    const hidden: components['schemas']['HiddenMessage'] = { ...visible, status: 'HIDDEN' };
    const items = orderedMessages([{ items: [hidden], nextCursor: 'older' }, { items: [visible, { ...visible, id: 'b', createdAt: '2026-11-01T08:00:00Z' }], nextCursor: null }]);
    expect(items.map((item) => item.id)).toEqual(['b', 'a']);
    expect(items[1].status).toBe('HIDDEN');
  });
  it('finds midnight in the event zone across seasonal transitions', () => {
    expect(new Date(nextLocalDay(Date.parse('2026-10-25T00:00:00Z'), 'Europe/Berlin')).toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(new Date(nextLocalDay(Date.parse('2026-11-01T16:59:59Z'), 'Asia/Krasnoyarsk')).toISOString()).toBe('2026-11-01T17:00:00.000Z');
  });
  it('continues a guest question after login but never gives a personal draft to another account', () => {
    clearMessageDraft(); saveMessageDraft({ eventId: 'event', ownerId: null, body: 'Вопрос', uncertain: false });
    expect(readMessageDraft('event', 'anna').body).toBe('Вопрос');
    expect(readMessageDraft('event', 'alex').body).toBe('');
    clearMessageDraft();
  });
});
