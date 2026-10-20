import { describe, expect, it } from 'vitest';
import { authLink, safeReturnTo } from './return-to';

describe('auth return target', () => {
  it.each([null, '', 'https://outside.test', '//outside.test', '/\\outside.test', '/%2f%2foutside.test', '/login', '/register?returnTo=/login', '/api/v1/auth/logout', '/dev/ui', '/%6cogin', '/events\n/1', '/bad%zz'])('rejects unsafe or looping target %s', (value) => {
    expect(safeReturnTo(value)).toBe('/');
  });
  it('preserves a local path and query without executing the action', () => {
    expect(safeReturnTo('/events/123?tab=discussion#last')).toBe('/events/123?tab=discussion#last');
    expect(authLink('/register', '/events/123?tab=discussion')).toBe('/register?returnTo=%2Fevents%2F123%3Ftab%3Ddiscussion');
  });
});
