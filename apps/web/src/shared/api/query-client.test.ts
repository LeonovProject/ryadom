import { expect, it } from 'vitest';
import { createQueryClient } from './query-client';

it('does not replay a mutation after an uncertain network result', async () => {
  const client = createQueryClient();
  let attempts = 0;
  const mutation = client.getMutationCache().build(client, {
    mutationFn: async () => {
      attempts++;
      throw new TypeError('Failed to fetch');
    },
  });
  await expect(mutation.execute(undefined)).rejects.toThrow('Failed to fetch');
  expect(attempts).toBe(1);
  client.clear();
});
