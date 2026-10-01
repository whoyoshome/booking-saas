import { describe, expect, it } from 'vitest';
import { minutesFrom, NOW } from '../test/helpers';
import { describeExpiry, describeStart, formatDuration, minutesFromNow } from './format-time';

describe('minutesFromNow', () => {
  it('is positive for the future and negative for the past', () => {
    expect(minutesFromNow(minutesFrom(90), NOW)).toBeCloseTo(90, 9);
    expect(minutesFromNow(minutesFrom(-15), NOW)).toBeCloseTo(-15, 9);
  });

  it('is NaN for an unparseable date', () => {
    expect(minutesFromNow('nope', NOW)).toBeNaN();
  });
});

describe('formatDuration', () => {
  it.each([
    [0, 'menos de 1 min'],
    [0.4, 'menos de 1 min'],
    [-5, 'menos de 1 min'],
    [1, '1 min'],
    [45, '45 min'],
    [59.4, '59 min'],
    [59.6, '1 h'],
    [60, '1 h'],
    [135, '2 h 15 min'],
    [1439, '23 h 59 min'],
    [1440, '1 d'],
    [3000, '2 d 2 h'],
  ])('%s min -> "%s"', (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });

  it.each([NaN, Infinity, -Infinity])('%s -> a dash, not "NaN min"', (value) => {
    expect(formatDuration(value)).toBe('—');
  });
});

describe('describeExpiry', () => {
  it('counts down while the hold is alive', () => {
    expect(describeExpiry(2)).toBe('Vence en 2 min');
    expect(describeExpiry(0.4)).toBe('Vence en menos de 1 min');
  });

  it('says the next sweep cancels it once the time is up', () => {
    const expected = 'Plazo vencido: se cancela en el próximo barrido';
    expect(describeExpiry(0)).toBe(expected);
    expect(describeExpiry(-3)).toBe(expected);
  });

  it('is empty for an unparseable value', () => {
    expect(describeExpiry(NaN)).toBe('');
  });
});

describe('describeStart', () => {
  it('counts down to the start', () => {
    expect(describeStart(40)).toBe('Empieza en 40 min');
    expect(describeStart(24 * 60)).toBe('Empieza en 1 d');
  });

  it('says it already started at or after the start', () => {
    expect(describeStart(0)).toBe('Ya empezó');
    expect(describeStart(-10)).toBe('Ya empezó');
  });

  it('is empty for an unparseable value', () => {
    expect(describeStart(NaN)).toBe('');
  });
});
