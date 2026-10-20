import { describe, expect, it } from 'vitest';
import { resolveLocalTime } from '../local-time';

describe('wall-clock input belongs to the event zone', () => {
  it.each([
    ['2026-11-07T01:00', 'Asia/Krasnoyarsk', '2026-11-06T18:00:00.000Z'],
    ['2026-01-10T13:00', 'Europe/Berlin', '2026-01-10T12:00:00.000Z'],
    ['2026-07-10T14:00', 'Europe/Berlin', '2026-07-10T12:00:00.000Z'],
    ['2026-11-07T05:45', 'Asia/Kathmandu', '2026-11-07T00:00:00.000Z'],
    ['2026-11-07T00:00', 'Pacific/Kiritimati', '2026-11-06T10:00:00.000Z'],
    ['2026-11-07T00:00', 'Pacific/Pago_Pago', '2026-11-07T11:00:00.000Z'],
    ['2028-02-29T00:00', 'UTC', '2028-02-29T00:00:00.000Z'],
  ])('resolves %s in %s', (local, timezone, startsAt) => {
    expect(resolveLocalTime(local, timezone)).toEqual({ startsAt });
  });
  it.each([
    ['2026-03-29T02:30', 'Europe/Berlin'],
    ['2026-03-08T02:30', 'America/New_York'],
    ['2026-10-04T02:15', 'Australia/Lord_Howe'],
    ['2011-12-30T12:00', 'Pacific/Apia'],
  ])('rejects nonexistent local time %s in %s', (local, timezone) => {
    expect(resolveLocalTime(local, timezone).error).toContain('не существует');
  });
  it.each([
    ['2026-10-25T02:30', 'Europe/Berlin'],
    ['2026-11-01T01:30', 'America/New_York'],
    ['2026-04-05T01:45', 'Australia/Lord_Howe'],
  ])('rejects repeated local time %s in %s', (local, timezone) => {
    expect(resolveLocalTime(local, timezone).error).toContain('повторяется');
  });
  it.each(['', '2026-02-29T12:00', '2026-04-31T12:00', '2026-01-01T24:00', '2026-01-01T12:60', '2026-11-07T12:00Z', '0000-01-01T12:00'])('rejects malformed/calendar input %s', (value) => {
    expect(resolveLocalTime(value, 'UTC').error).toBeTruthy();
  });
  it.each(['', 'Unknown/Zone', '+07:00'])('rejects a missing or non-IANA zone %s', (zone) => {
    expect(resolveLocalTime('2026-11-07T12:00', zone).error).toContain('IANA');
  });
});
