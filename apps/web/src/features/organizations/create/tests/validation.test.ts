import { describe, expect, it } from 'vitest';
import { emptyOrganization, organizationFieldErrors, organizationInput, validateOrganization } from '../validation';

const valid = () => ({ name: 'Клуб', description: 'Занимаемся вместе', sportInterests: 'Петанк' });
describe('organization profile fields', () => {
  it('requires all three fields, including whitespace-only text', () => {
    expect(Object.keys(validateOrganization(emptyOrganization()))).toEqual(['name', 'description', 'sportInterests']);
    expect(validateOrganization({ name: '  ', description: '\n', sportInterests: '\t' })).toEqual({ name: expect.any(String), description: expect.any(String), sportInterests: expect.any(String) });
  });
  it.each([['name', 160], ['description', 4000], ['sportInterests', 2000]] as const)('enforces the inclusive character limit of %s', (field, limit) => {
    expect(validateOrganization({ ...valid(), [field]: '🎾'.repeat(limit) })[field]).toBeUndefined();
    expect(validateOrganization({ ...valid(), [field]: '🎾'.repeat(limit + 1) })[field]).toBeTruthy();
  });
  it('sends profile fields with trimmed outer whitespace and retained line breaks', () => {
    expect(organizationInput({ name: ' Клуб ', description: '\nЗнакомимся\nИграем\n', sportInterests: ' Петанк ' })).toEqual({ name: 'Клуб', description: 'Знакомимся\nИграем', sportInterests: 'Петанк' });
  });
  it('associates server pointers with fields and ignores internal paths', () => {
    expect(organizationFieldErrors({ '/name': ['Ошибка'], '/sportInterests': ['Уточни спорт'], '/internal': ['PRIVATE'] })).toEqual({ name: 'Ошибка', sportInterests: 'Уточни спорт' });
  });
});
