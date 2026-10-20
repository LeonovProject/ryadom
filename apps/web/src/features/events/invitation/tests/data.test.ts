import { expect, it } from 'vitest';
import fs from 'node:fs';
import type { components } from '../../../../shared/api/client';
import { invitationData, invitationUrl, shortDescription } from '../data';
import { createInvitationQr } from '../../../../shared/qr';
const examples = JSON.parse(fs.readFileSync('packages/contracts/examples/http-cases.json', 'utf8'));
const event = () => ({ ...examples.find((x: {name: string}) => x.name === 'getEventSuccess').responseBody, startsAt: '2099-11-06T18:00:00Z' }) as components['schemas']['PublishedEventDetail'];
const id = '00000002-0000-4000-8000-000000000001';
it('builds a canonical URL without query/hash and rejects invalid UUIDs and schemes', () => {
  expect(invitationUrl('https://example.test/path?jwt=secret#private', id)).toBe(`https://example.test/events/${id}`);
  expect(() => invitationUrl('https://example.test', 'bad')).toThrow();
  expect(() => invitationUrl('javascript:alert(1)', id)).toThrow();
});
it('picks public printed fields regardless of canJoin and detects loopback and unavailable events', () => {
  const source = event(); source.capabilities.canJoin = false;
  const data = invitationData(source, 'http://127.0.0.2:8080');
  expect(data.loopback).toBe(true); expect(data.when).toContain('GMT+7');
  expect(data).not.toHaveProperty('myParticipation'); expect(data).not.toHaveProperty('activityTypeReview'); expect(data).not.toHaveProperty('confirmedCount');
  expect(() => invitationData({ ...source, publicationStatus: 'UNPUBLISHED' } as unknown as components['schemas']['EventDetail'], 'https://example.test')).toThrow(/снята/);
  expect(() => invitationData(source, 'https://example.test', Date.parse(source.startsAt))).toThrow(/уже началась/);
});
it('shortens only descriptions beyond 500 code points, at a word boundary or the hard limit', () => {
  for (const n of [499,500]) expect(shortDescription('🎾'.repeat(n))).toEqual({ text: '🎾'.repeat(n), shortened: false });
  expect(shortDescription('🎾'.repeat(501))).toEqual({ text: '🎾'.repeat(500)+'…', shortened: true });
  expect(shortDescription('x'.repeat(490)+' '+'word'.repeat(5)).text).toBe('x'.repeat(490)+'…');
});
it('encodes a local 512px PNG and rejects missing or non-http input', async () => {
  const png = await createInvitationQr(invitationUrl('https://example.test', id));
  const bytes = Buffer.from(png.split(',')[1], 'base64');
  expect(bytes.readUInt32BE(16)).toBe(512); expect(bytes.readUInt32BE(20)).toBe(512);
  await expect(createInvitationQr('')).rejects.toThrow();
  await expect(createInvitationQr('javascript:alert(1)')).rejects.toThrow();
});
