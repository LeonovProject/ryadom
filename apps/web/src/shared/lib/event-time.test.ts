import { describe, expect, it } from 'vitest';
import { formatEventStart } from './event-time';

describe('event time belongs to the meeting timezone', () => {
  it('crosses a UTC calendar boundary in Krasnoyarsk', () => {
    const text = formatEventStart({ startsAt: '2026-11-06T18:00:00Z', timezone: 'Asia/Krasnoyarsk' });
    expect(text).toContain('7 ноября 2026');
    expect(text).toContain('01:00');
    expect(text).toContain('GMT+7');
  });

  it.each([
    ['2026-01-10T12:00:00Z', '13:00', 'GMT+1'],
    ['2026-07-10T12:00:00Z', '14:00', 'GMT+2'],
  ])('uses the offset on the event date: %s', (startsAt, clock, offset) => {
    const text = formatEventStart({ startsAt, timezone: 'Europe/Berlin' });
    expect(text).toContain(clock);
    expect(text).toContain(offset);
  });

  it('preserves a fractional offset', () => {
    const text = formatEventStart({ startsAt: '2026-11-07T00:00:00Z', timezone: 'Asia/Kathmandu' });
    expect(text).toContain('05:45');
    expect(text).toContain('GMT+5:45');
  });

  it('does not silently substitute the device timezone for invalid data', () => {
    expect(() => formatEventStart({ startsAt: 'invalid', timezone: 'Asia/Krasnoyarsk' })).toThrow(RangeError);
    expect(() => formatEventStart({ startsAt: '2026-11-07T00:00:00Z', timezone: 'invalid-zone' })).toThrow(RangeError);
  });
});
