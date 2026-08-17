import { describe, expect, it } from 'vitest';
import { localDateKey } from './date.ts';

describe('localDateKey', () => {
  it('uses local calendar fields instead of UTC slicing', () => {
    const date = new Date(2026, 0, 2, 0, 15);
    expect(localDateKey(date)).toBe('2026-01-02');
  });

  it('pads single digit months and days', () => {
    expect(localDateKey(new Date(2026, 8, 7))).toBe('2026-09-07');
  });
});
