import { describe, expect, it } from 'vitest';
import { createCatalogPositionMemory, type CatalogPosition } from '../return-position';

const position: CatalogPosition = { url: '/events?from=2026-10-20T07%3A00%3A00Z&city=Красноярск', epoch: 2, eventId: '00000002-0000-4000-8000-ABCDEFABCDEF', offset: -100, link: 'action' };
describe('one catalog return position per session and URL', () => {
  it('keeps an independent snapshot and reads it without destructive render side effects', () => {
    const memory = createCatalogPositionMemory(); const input = { ...position }; memory.save(input); input.offset = 900;
    const first = memory.read(position.url, 2)!; first.offset = 42;
    expect(memory.read(position.url, 2)).toEqual({ ...position, eventId: position.eventId.toLowerCase() });
  });
  it('does not restore a previous actor or another set of filters', () => {
    const memory = createCatalogPositionMemory(); memory.save(position);
    expect(memory.read(position.url, 3)).toBeUndefined(); expect(memory.read('/events?city=Москва', 2)).toBeUndefined();
  });
  it('replaces the previous bookmark and explicitly discards it', () => {
    const memory = createCatalogPositionMemory(); memory.save(position); memory.save({ ...position, eventId: 'another', offset: 0, link: 'title' });
    expect(memory.read(position.url, 2)?.eventId).toBe('another'); memory.clear(); expect(memory.read(position.url, 2)).toBeUndefined();
  });
});
