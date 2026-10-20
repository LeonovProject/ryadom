import { describe, expect, it } from 'vitest';
import type { components } from '../../../../shared/api/client';
import { httpCase } from '../../../auth/tests/http-fixtures';
import { verifyOwner } from '../api';
import { uniqueOrganizations, uniqueOrganizationEvents } from '../queries';

const org = () => httpCase('getMyOrganizationSuccess').responseBody as components['schemas']['PrivateOrganization'];
describe('private organization read boundaries', () => {
  it('never accepts a private profile owned by another account', () => {
    expect(() => verifyOwner(org(), '00000001-0000-4000-8000-000000000099')).toThrow();
    expect(() => verifyOwner(org(), org().owner.id)).not.toThrow();
  });
  it('deduplicates organizations across pages without moving server order', () => {
    const first = org(); const second = { ...first, id: '00000003-0000-4000-8000-000000000002', name: 'Другой клуб' };
    const fresh = { ...first, approvalState: 'APPROVED' as const };
    expect(uniqueOrganizations([{ items: [first], nextCursor: 'next' }, { items: [second, fresh], nextCursor: null }])).toEqual([fresh, second]);
  });
  it('replaces a published event by its limited unavailable variant instead of merging private fields', () => {
    const page = httpCase('listMyEventsSuccess').responseBody as components['schemas']['OwnedEventPage'];
    const unavailable: components['schemas']['OwnedEventEntry'] = { event: { id: page.items[0].event.id, title: 'Недоступно', publicationStatus: 'UNPUBLISHED' }, canManageParticipants: false };
    const items = uniqueOrganizationEvents([page, { items: [unavailable], nextCursor: null }]);
    expect(items).toEqual([unavailable]);
    expect(items[0].event).not.toHaveProperty('locationText');
  });
});
