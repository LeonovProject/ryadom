import { describe, expect, it } from 'vitest';
import { filterSearch, readFilters, safeListSearch } from '../filters';
import { verifyOrganization } from '../api';
import { uniqueOrganizations } from '../queries';
import { organizationFixture } from '../../../organizations/private/tests/fixtures';

describe('administrative organization boundaries', () => {
  it('keeps only contract filters and drops pagination before applying a search', () => {
    expect(readFilters('?q=%20Бег%20&approvalState=NOT_SUBMITTED&cursor=old')).toEqual({ q: 'Бег', approvalState: 'NOT_SUBMITTED' });
    expect(filterSearch(' Бег ', 'PENDING')).toBe('?q=%D0%91%D0%B5%D0%B3&approvalState=PENDING');
    expect(safeListSearch('?q=бег&cursor=old&returnTo=https://evil.test')).not.toMatch(/cursor|returnTo|evil/);
  });
  it('validates search by unicode code points and rejects unknown states', () => {
    expect(() => readFilters(`?q=${'😀'.repeat(200)}`)).not.toThrow();
    expect(() => readFilters(`?q=${'😀'.repeat(201)}`)).toThrow('200');
    expect(() => readFilters('?approvalState=HIDDEN')).toThrow();
    expect(safeListSearch('?approvalState=HIDDEN')).toBe('');
  });
  it('accepts all four approval states without confusing admin capabilities with ownership', () => {
    for (const state of ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'] as const) expect(() => verifyOrganization({ ...organizationFixture(state), canPublish: false, canSubmit: false })).not.toThrow();
  });
  it('rejects wrong application links and mismatched states before display', () => {
    const item = organizationFixture('PENDING');
    expect(() => verifyOrganization({ ...item, application: { ...item.application!, organizationId: 'another' } })).toThrow();
    expect(() => verifyOrganization({ ...item, approvalState: 'APPROVED' })).toThrow();
    expect(() => verifyOrganization({ ...item, application: null })).toThrow();
    expect(() => verifyOrganization({ ...item, approvalState: 'NOT_SUBMITTED' })).toThrow();
  });
  it('deduplicates overlapping pages by identity, replaces whole data and preserves server order', () => {
    const first = organizationFixture('PENDING'); const second = organizationFixture('NOT_SUBMITTED', '00000003-0000-4000-8000-000000000002');
    const final = { ...organizationFixture('REJECTED'), id: first.id.toUpperCase() };
    expect(uniqueOrganizations([{ items: [first, second], nextCursor: 'next' }, { items: [final], nextCursor: null }])).toEqual([final, second]);
  });
});
