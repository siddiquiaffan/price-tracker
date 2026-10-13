import { describe, expect, it } from 'vitest';
import { Money } from '../src/core/entities/money.js';
import { ValidationError } from '../src/core/errors/app-error.js';

describe('Money', () => {
  describe('parse', () => {
    it('parses INR with the rupee glyph and Indian grouping', () => {
      const money = Money.parse('₹1,29,999.99');
      expect(money.currency).toBe('INR');
      expect(money.minorUnits).toBe(12999999);
      expect(money.toMajorString()).toBe('129999.99');
    });

    it('parses an ISO-code prefix', () => {
      const money = Money.parse('USD 12.5');
      expect(money.currency).toBe('USD');
      expect(money.minorUnits).toBe(1250);
    });

    it('falls back to the supplied currency when no symbol is present', () => {
      const money = Money.parse('1,299', 'INR');
      expect(money.currency).toBe('INR');
      expect(money.minorUnits).toBe(129900);
    });

    it('throws for non-numeric input', () => {
      expect(() => Money.parse('out of stock', 'INR')).toThrow(ValidationError);
    });

    it('throws for too many decimals for the currency exponent', () => {
      expect(() => Money.parse('1.999', 'INR')).toThrow(ValidationError);
    });

    it('handles zero-decimal currencies (JPY)', () => {
      const money = Money.parse('¥1,299');
      expect(money.currency).toBe('JPY');
      expect(money.minorUnits).toBe(1299);
    });
  });

  describe('arithmetic', () => {
    it('adds and subtracts in the same currency', () => {
      const a = Money.fromMinorUnits(1000, 'INR');
      const b = Money.fromMinorUnits(250, 'INR');
      expect(a.add(b).minorUnits).toBe(1250);
      expect(a.subtract(b).minorUnits).toBe(750);
    });

    it('refuses mixed-currency arithmetic', () => {
      const a = Money.fromMinorUnits(1000, 'INR');
      const b = Money.fromMinorUnits(1000, 'USD');
      expect(() => a.add(b)).toThrow(ValidationError);
      expect(() => a.compare(b)).toThrow(ValidationError);
    });
  });

  describe('comparison', () => {
    it('compares amounts', () => {
      const a = Money.fromMinorUnits(1000);
      const b = Money.fromMinorUnits(2000);
      expect(a.compare(b)).toBe(-1);
      expect(a.equals(a)).toBe(true);
      expect(a.greaterThan(b)).toBe(false);
      expect(b.greaterThan(a)).toBe(true);
      expect(a.lessThan(b)).toBe(true);
    });
  });

  describe('percentageChangeFrom', () => {
    it('computes a signed percentage drop', () => {
      const previous = Money.fromMinorUnits(10000);
      const current = Money.fromMinorUnits(8750);
      expect(current.percentageChangeFrom(previous)).toBeCloseTo(-12.5, 5);
    });

    it('returns 0 when the previous price is zero', () => {
      const previous = Money.zero();
      const current = Money.fromMinorUnits(500);
      expect(current.percentageChangeFrom(previous)).toBe(0);
    });
  });

  describe('formatting', () => {
    it('formats a localised string', () => {
      const money = Money.fromMinorUnits(12999999, 'INR');
      expect(money.format()).toBe('₹1,29,999.99');
    });

    it('serialises as plain major units', () => {
      expect(Money.fromMinorUnits(1299, 'INR').toMajorString()).toBe('12.99');
      expect(Money.zero('INR').toMajorString()).toBe('0.00');
    });
  });

  describe('validation', () => {
    it('rejects unsafe integers and bad currency codes', () => {
      expect(() => Money.fromMinorUnits(Number.MAX_SAFE_INTEGER + 1)).toThrow(ValidationError);
      expect(() => Money.fromMinorUnits(100, 'indian-rupee')).toThrow(ValidationError);
    });
  });
});
