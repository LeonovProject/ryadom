import { expect, it } from 'vitest';
import type { components } from '../../../../shared/api/client';
import { httpCase } from '../../../auth/tests/http-fixtures';
import { uniqueEvents } from '../queries';

it('updates a case-equivalent UUID across pages without duplication, field merging or reordering', () => {
  const first = (httpCase('listEventsSuccess').responseBody as components['schemas']['EventPage']).items[0];
  const initial = { ...first, id: '00000002-0000-4000-8000-abcdefabcdef', coverUrl: '/old.svg' };
  const second = { ...first, id: '00000002-0000-4000-8000-000000000099' };
  const updated = { ...initial, id: initial.id.toUpperCase(), coverUrl: null, title: 'Обновлено' };
  expect(uniqueEvents([{ items: [initial, second], nextCursor: 'next' }, { items: [updated], nextCursor: null }])).toEqual([updated, second]);
});
