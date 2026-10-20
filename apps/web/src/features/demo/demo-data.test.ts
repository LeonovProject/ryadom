import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import accounts from '../../../demo-accounts.json';

test('public demo identities match actual DB-02 seed credentials and names', () => {
  const seed = readFileSync(resolve('apps/api/db/seed/dataset.go'), 'utf8');
  const entries = [...seed.matchAll(/\{"([a-z]+)", "([^"]+)", "([^"]+)", "(USER|ADMIN)", "(ACTIVE|BLOCKED)"\}/g)];
  const expected = entries.map(([, key, name, password]) => ({ key, name, password, email: `${key}@example.test` }));
  expect(expected).toHaveLength(6);
  expect(accounts.map(({ key, name, password, email }) => ({ key, name, password, email })).sort((a, b) => a.key.localeCompare(b.key)))
    .toEqual(expected.sort((a, b) => a.key.localeCompare(b.key)));
  expect(new Set(accounts.map((account) => account.key)).size).toBe(accounts.length);
});
