import { expect, it } from 'vitest';
import { advanceSession, reportSessionLoss, sessionEpoch, subscribeSession } from './session-boundary';

it('ignores revocation responses belonging to a previous actor', () => {
  const received: unknown[] = [];
  const unsubscribe = subscribeSession((notice) => received.push(notice));
  const oldEpoch = sessionEpoch();
  advanceSession();
  reportSessionLoss(oldEpoch, 'blocked');
  expect(received).toEqual([]);
  reportSessionLoss(sessionEpoch(), 'expired');
  expect(received).toEqual(['expired']);
  unsubscribe();
});
