import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUpcomingContests } from './client.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchUpcomingContests', () => {
  it('keeps upcoming contests, sorts them, and applies the limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'OK',
      result: [
        { id: 3, name: 'Running', phase: 'CODING', type: 'CF', durationSeconds: 7200, startTimeSeconds: 1 },
        { id: 2, name: 'Later', phase: 'BEFORE', type: 'ICPC', durationSeconds: 7200, startTimeSeconds: 300 },
        { id: 1, name: 'Sooner', phase: 'BEFORE', type: 'CF', durationSeconds: 9000, startTimeSeconds: 200 },
      ],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const contests = await fetchUpcomingContests(1);

    expect(contests).toEqual([{
      id: 1,
      name: 'Sooner',
      type: 'CF',
      startsAt: 200_000,
      durationSeconds: 9000,
    }]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/contest.list?gym=false');
  });
});
