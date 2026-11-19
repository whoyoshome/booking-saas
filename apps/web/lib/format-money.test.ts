import { describe, expect, it } from 'vitest';
import { DISPLAY_CURRENCY, formatPrice } from './format-money';

describe('formatPrice', () => {
  it('uses the display currency (the data model stores none)', () => {
    expect(DISPLAY_CURRENCY).toBe('USD');
    expect(formatPrice(35)).toBe('$35');
  });

  it('accepts the Decimal-as-string the API returns', () => {
    expect(formatPrice('35.00')).toBe('$35');
    expect(formatPrice('35.50')).toBe('$35.50');
  });

  it('groups thousands the en-US way', () => {
    expect(formatPrice('25000.00')).toBe('$25,000');
  });

  it('formats another currency when one is passed', () => {
    expect(formatPrice(60, 'EUR')).toBe('€60');
  });

  it('shows an unparseable value as-is instead of "NaN"', () => {
    expect(formatPrice('n/a')).toBe('n/a');
  });
});
