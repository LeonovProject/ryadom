import type { components } from '../../../shared/api/client';
export type OrganizationValues = components['schemas']['CreateOrganizationInput'];
export type OrganizationField = keyof OrganizationValues;
export type OrganizationErrors = Partial<Record<OrganizationField, string>>;
export const emptyOrganization = (): OrganizationValues => ({ name: '', description: '', sportInterests: '' });
export function validateOrganization(values: OrganizationValues): OrganizationErrors {
  const errors: OrganizationErrors = {};
  for (const [field, limit] of [['name', 160], ['description', 4000], ['sportInterests', 2000]] as const) {
    const text = values[field].trim();
    if (!text) errors[field] = 'Заполни это поле.';
    else if ([...text].length > limit) errors[field] = `Не больше ${limit} символов.`;
  }
  return errors;
}
export function organizationInput(values: OrganizationValues): OrganizationValues {
  return { name: values.name.trim(), description: values.description.trim(), sportInterests: values.sportInterests.trim() };
}
export function organizationFieldErrors(fields: Record<string, string[]>): OrganizationErrors {
  const errors: OrganizationErrors = {};
  for (const field of ['name', 'description', 'sportInterests'] as const) if (fields[`/${field}`]?.length) errors[field] = fields[`/${field}`].join(' ');
  return errors;
}
