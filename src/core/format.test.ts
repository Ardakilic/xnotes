import { describe, expect, it } from 'vitest';
import { formatTimestamp } from './format';

describe('formatTimestamp', () => {
  it('zero-pads single-digit parts (local time)', () => {
    expect(formatTimestamp(new Date(2026, 0, 5, 7, 9).getTime())).toBe('2026-01-05 07:09');
  });

  it('keeps double-digit parts unchanged', () => {
    expect(formatTimestamp(new Date(2026, 11, 24, 14, 30).getTime())).toBe('2026-12-24 14:30');
  });

  it('always renders the YYYY-MM-DD HH:MM shape', () => {
    expect(formatTimestamp(Date.now())).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
