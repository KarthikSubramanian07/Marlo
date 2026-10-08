import { describe, expect, it } from 'vitest';
import { verifyPublished } from './verify-published.mjs';

describe('published resource verification', () => {
  it('returns immediately after a successful full verification', async () => {
    let calls = 0;
    await verifyPublished(
      () => {
        calls += 1;
      },
      () => {
        throw new Error('Unexpected retry');
      },
    );
    expect(calls).toBe(1);
  });
  it('rechecks all resources after a temporarily stale response', async () => {
    let calls = 0;
    const delays = [];
    await verifyPublished(
      () => {
        calls += 1;
        if (calls === 1) throw new Error('The page still returns the earlier representation');
      },
      (ms) => {
        delays.push(ms);
      },
    );
    expect(calls).toBe(2);
    expect(delays).toEqual([20_000]);
  });
  it('fails after bounded retries and preserves the failed verification', async () => {
    let calls = 0;
    let waits = 0;
    const error = new Error('Wrong content type');
    await expect(
      verifyPublished(
        () => {
          calls += 1;
          throw error;
        },
        () => {
          waits += 1;
        },
      ),
    ).rejects.toBe(error);
    expect(calls).toBe(3);
    expect(waits).toBe(2);
  });
});
