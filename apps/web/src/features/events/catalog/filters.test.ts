import { describe, expect, it } from 'vitest';
import { adjacentDay, applyDraft, draftFromSearch, isCalendarDate, parseCatalogSearch } from './filters';

const from = '2026-10-20T07:00:00Z';
const type = '00000007-0000-4000-8000-000000000005';

describe('calendar date arithmetic without device timezone', () => {
  it.each([
    ['2026-11-07', '2026-11-08'], ['2026-12-31', '2027-01-01'],
    ['2028-02-28', '2028-02-29'], ['2028-02-29', '2028-03-01'], ['2100-02-28', '2100-03-01'],
  ])('adds a local calendar day to %s', (day, next) => {
    expect(adjacentDay(day, 1)).toBe(next);
    expect(adjacentDay(next, -1)).toBe(day);
  });
  it.each(['2026-02-29', '2026-04-31', '0000-01-01', '2026-13-01', '2026-1-01', 'not-a-date'])('rejects invalid day %s', (day) => {
    expect(isCalendarDate(day)).toBe(false);
    expect(() => adjacentDay(day, 1)).toThrow(RangeError);
  });
  it('rejects arithmetic outside the date format', () => {
    expect(() => adjacentDay('9999-12-31', 1)).toThrow(RangeError);
    expect(() => adjacentDay('0001-01-01', -1)).toThrow(RangeError);
  });
});

describe('catalog filters and cursor scope', () => {
  it('sends a single chosen day and inclusive upper range as an exclusive local date', () => {
    const base = draftFromSearch('');
    const single = new URLSearchParams(applyDraft('', { ...base, firstDay: '2026-11-07' }, from));
    expect(single.get('dateFrom')).toBe('2026-11-07');
    expect(single.get('dateTo')).toBe('2026-11-08');
    const range = new URLSearchParams(applyDraft('', { ...base, firstDay: '2026-11-07', lastDay: '2026-11-09' }, from));
    expect(range.get('dateTo')).toBe('2026-11-10');
    expect(range.get('from')).toBe(from);
  });
  it('changes search/city without dropping mode, date, known unapproved ID or absolute bounds', () => {
    const search = new URLSearchParams({ activityTypeId: type, joinMode: 'APPROVAL', dateFrom: '2026-11-07', dateTo: '2026-11-10', from, to: '2026-12-01T00:00:00Z', cursor: 'opaque-value' }).toString();
    const next = new URLSearchParams(applyDraft(search, { ...draftFromSearch(search), q: '  Сапбординг  ', city: '  ' }, from));
    expect(next.get('q')).toBe('Сапбординг'); expect(next.has('city')).toBe(false);
    expect(next.get('activityTypeId')).toBe(type); expect(next.get('joinMode')).toBe('APPROVAL');
    expect(next.get('dateFrom')).toBe('2026-11-07'); expect(next.get('dateTo')).toBe('2026-11-10');
    expect(next.get('from')).toBe(from); expect(next.get('to')).toBe('2026-12-01T00:00:00Z');
    expect(next.has('cursor')).toBe(false);
  });
  it.each([
    'dateFrom=2026-02-29', 'dateTo=', 'dateFrom=2026-11-07&dateTo=2026-11-07',
    'from=2026-10-20T24%3A00%3A00Z', 'from=2026-10-20T07%3A00%3A00', 'from=2026-02-30T07%3A00%3A00Z',
    'joinMode=UNKNOWN', 'activityTypeId=nope', 'city=one&city=two',
    `organizationId=${type}&organizerAccountId=${type}`,
  ])('blocks malformed URL filters %s', (search) => expect(parseCatalogSearch(search, from).error).toBeTruthy());
  it('passes absolute and local date bounds together, never forwarding a URL cursor', () => {
    expect(parseCatalogSearch('dateFrom=2026-11-07&dateTo=2026-11-08&cursor=not-client-authoritative&city=', from)).toEqual({
      error: null, query: { from, limit: 12, dateFrom: '2026-11-07', dateTo: '2026-11-08' },
    });
  });
  it('rejects a reversed UI range', () => {
    expect(() => applyDraft('', { ...draftFromSearch(''), firstDay: '2026-11-09', lastDay: '2026-11-07' }, from)).toThrow(RangeError);
  });
});
