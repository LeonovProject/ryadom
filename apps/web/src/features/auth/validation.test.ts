import { expect, it } from 'vitest';
import { validateAuth, type AuthValues } from './validation';

const values: AuthValues = { displayName: ' Имя ', email: ' USER@example.test ', password: '💙'.repeat(15), confirmation: '💙'.repeat(15), presetId: 'ryadom-companion' };
it('counts Unicode code points and preserves spaces in passwords', () => {
  expect(validateAuth('register', values)).toEqual({});
  expect(validateAuth('register', { ...values, password: '💙'.repeat(14) }).password).toBeTruthy();
  const password = ` ${'x'.repeat(13)} `;
  expect(validateAuth('register', { ...values, password, confirmation: password })).toEqual({});
  expect(validateAuth('register', { ...values, password: '💙'.repeat(129) }).password).toBeTruthy();
});
it('requires explicit preset, matching confirmation and a trimmed nonempty name', () => {
  const result = validateAuth('register', { ...values, presetId: '', confirmation: '', displayName: '  ' });
  expect(Object.keys(result).sort()).toEqual(['confirmation', 'displayName', 'presetId']);
});
it('login allows existing short passwords but requires ASCII email and at most 128 code points', () => {
  expect(validateAuth('login', { ...values, password: ' ' })).toEqual({});
  expect(validateAuth('login', { ...values, email: 'я@example.test' }).email).toBeTruthy();
  expect(validateAuth('login', { ...values, password: '' }).password).toBeTruthy();
});
