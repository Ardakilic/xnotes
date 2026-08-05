import { describe, expect, it } from 'vitest';
import { isDarkBackground } from './theme';

describe('isDarkBackground', () => {
  it('treats black as dark and white as light', () => {
    expect(isDarkBackground('#000')).toBe(true);
    expect(isDarkBackground('#000000')).toBe(true);
    expect(isDarkBackground('rgb(0, 0, 0)')).toBe(true);
    expect(isDarkBackground('#fff')).toBe(false);
    expect(isDarkBackground('#ffffff')).toBe(false);
    expect(isDarkBackground('rgb(255, 255, 255)')).toBe(false);
  });

  it('classifies real X theme backgrounds', () => {
    expect(isDarkBackground('rgb(21, 32, 43)')).toBe(true);
    expect(isDarkBackground('#15202b')).toBe(true);
    expect(isDarkBackground('rgb(0, 0, 0)')).toBe(true);
    expect(isDarkBackground('#f7f9f9')).toBe(false);
    expect(isDarkBackground('rgb(255, 255, 255)')).toBe(false);
  });

  it('parses rgba with an alpha channel', () => {
    expect(isDarkBackground('rgba(0, 0, 0, 1)')).toBe(true);
    expect(isDarkBackground('rgba(255, 255, 255, 0.8)')).toBe(false);
  });

  it('treats fully transparent as light', () => {
    expect(isDarkBackground('rgba(0, 0, 0, 0)')).toBe(false);
  });

  it('is case-insensitive and tolerant of whitespace', () => {
    expect(isDarkBackground('  #FFF  ')).toBe(false);
    expect(isDarkBackground('RGB(0,0,0)')).toBe(true);
  });

  it('returns false for unparseable input', () => {
    expect(isDarkBackground('')).toBe(false);
    expect(isDarkBackground('transparent')).toBe(false);
    expect(isDarkBackground('hsl(0, 0%, 0%)')).toBe(false);
    expect(isDarkBackground('#12345')).toBe(false);
    expect(isDarkBackground('rgb(999, 0, 0)')).toBe(false);
    expect(isDarkBackground('rgb(0, 0)')).toBe(false);
  });
});
