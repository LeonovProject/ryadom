import { describe, expect, it } from 'vitest';
import { catalogReturnTo, profileReturnTo } from '../navigation';

const event = '/events/abcdefab-0000-4000-8000-000000000001';
describe('public reading navigation', () => {
  it('retains catalog filters through the organizer profile', () => {
    const state = { eventReturnTo: event, catalogReturnTo: '/events?city=%D0%9A%D1%80%D0%B0%D1%81%D0%BD%D0%BE%D1%8F%D1%80%D1%81%D0%BA&joinMode=OPEN' };
    const back = profileReturnTo(state);
    expect(back.to).toBe(event);
    expect(catalogReturnTo(back.state)).toBe(state.catalogReturnTo);
  });
  it('uses the catalog for a direct profile visit or an unsafe event target', () => {
    for (const state of [null, {}, { eventReturnTo: 'https://example.test' }, { eventReturnTo: '//example.test' }, { eventReturnTo: '/events/new' }, { eventReturnTo: `${event}?returnTo=bad` }]) {
      expect(profileReturnTo(state).to).toBe('/events');
    }
  });
  it('rejects non-catalog return targets even for a valid event link', () => {
    for (const target of ['/login', '/events/new', '//example.test', 'https://example.test', '/events?x=\n']) {
      expect(catalogReturnTo({ catalogReturnTo: target })).toBe('/events');
    }
    expect(profileReturnTo({ eventReturnTo: event, catalogReturnTo: '/me' }).state).toEqual({ catalogReturnTo: '/events' });
  });
});
