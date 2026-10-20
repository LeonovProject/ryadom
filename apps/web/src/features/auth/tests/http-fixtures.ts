import { type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { components } from '../../../shared/api/client';

type Fixture = { name: string; responseStatus: number; responseBody?: unknown; responseHeaders: Record<string, string> };
const cases: Fixture[] = JSON.parse(fs.readFileSync(path.resolve('packages/contracts/examples/http-cases.json'), 'utf8'));

export function httpCase(name: string): Fixture {
  const item = cases.find((entry) => entry.name === name);
  if (!item) throw new Error(`Missing contract fixture: ${name}`);
  return structuredClone(item);
}

export async function fulfillCase(route: Route, name: string, override?: { responseBody?: unknown; headers?: Record<string, string> }) {
  const item = httpCase(name);
  const { ['Set-Cookie']: _sampleCookie, ...headers } = item.responseHeaders;
  await route.fulfill({
    status: item.responseStatus,
    headers: { ...headers, ...override?.headers },
    ...(item.responseBody !== undefined ? { contentType: 'application/json', body: JSON.stringify(override?.responseBody ?? item.responseBody) } : {}),
  });
}

export function meFixture(): components['schemas']['Me'] {
  return httpCase('getMeSuccess').responseBody as components['schemas']['Me'];
}

export async function guestFixtures(page: Page) {
  await page.route('**/api/v1/me', (route) => fulfillCase(route, 'authenticationRequired'));
  await page.route('**/api/v1/avatar-presets', (route) => fulfillCase(route, 'avatarPresetsPopulated'));
  await page.route('**/api/v1/activity-types', (route) => fulfillCase(route, 'listActivityTypesSuccess'));
  await page.route('**/api/v1/events?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const page = httpCase('listEventsSuccess').responseBody as components['schemas']['EventPage'];
    const person = params.get('organizerAccountId');
    const organization = params.get('organizationId');
    if (person) page.items[0].organizer = { type: 'PERSONAL', account: { id: person, displayName: person.endsWith('0001') ? 'Алексей' : 'Анна', avatarUrl: null, isBlocked: false } };
    if (organization) page.items[0].organizer = { type: 'ORGANIZATION', organization: { id: organization, name: 'Клуб «Темп»' }, ownerIsBlocked: false };
    return fulfillCase(route, 'listEventsSuccess', { responseBody: page });
  });
  await page.route('**/api/v1/events/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    const event = httpCase('getEventSuccess').responseBody as components['schemas']['PublishedEventDetail'];
    return fulfillCase(route, 'getEventSuccess', { responseBody: { ...event, id } });
  });
  await page.route('**/api/v1/accounts/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    const account = httpCase('publicProfileWithPreset').responseBody as components['schemas']['PublicAccount'];
    return fulfillCase(route, 'publicProfileWithPreset', { responseBody: { ...account, id, displayName: id.endsWith('0001') ? 'Алексей' : 'Анна' } });
  });
  await page.route('**/api/v1/organizations/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    return fulfillCase(route, 'getOrganizationSuccess', { responseBody: { ...(httpCase('getOrganizationSuccess').responseBody as object), id } });
  });
  await page.route('**/assets/avatars/presets/ryadom-companion.svg', (route) => route.fulfill({
    contentType: 'image/svg+xml', path: path.resolve('packages/contracts/avatar-presets/ryadom-companion.svg'),
  }));
}
