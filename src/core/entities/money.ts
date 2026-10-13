import { ValidationError } from '../errors/app-error.js';

export const DEFAULT_CURRENCY = 'INR';

/** Map of common currency glyphs to ISO 4217 codes. */
const CURRENCY_SYMBOLS: ReadonlyMap<string, string> = new Map([
  ['₹', 'INR'],
  ['$', 'USD'],
  ['£', 'GBP'],
  ['€', 'EUR'],
  ['¥', 'JPY'],
  ['₩', 'KRW'],
  ['A$', 'AUD'],
  ['C$', 'CAD'],
]);

/** Minor-unit exponent per currency (defaults to 2). */
const MINOR_UNIT_EXPONENTS: Readonly<Record<string, number>> = {
  INR: 2,
  USD: 2,
  GBP: 2,
  EUR: 2,
  AUD: 2,
  CAD: 2,
  JPY: 0,
  KRW: 0,
};

const LOCALES: Readonly<Record<string, string>> = {
  INR: 'en-IN',
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'de-DE',
};

export function currencyExponent(currency: string): number {
  return MINOR_UNIT_EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** Immutable money amount stored as integer minor units + ISO currency code. */
export class Money {
  private constructor(
    readonly minorUnits: number,
    readonly currency: string,
  ) {
    if (!Number.isSafeInteger(minorUnits)) {
      throw new ValidationError(`Money amount is not a safe integer: ${minorUnits}`);
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ValidationError(`Invalid currency code: ${currency}`);
    }
  }

  static fromMinorUnits(minorUnits: number, currency: string = DEFAULT_CURRENCY): Money {
    return new Money(minorUnits, currency.toUpperCase());
  }

  static zero(currency: string = DEFAULT_CURRENCY): Money {
    return new Money(0, currency.toUpperCase());
  }

  /**
   * Parse a human price string such as `₹1,29,999.00`, `$1,299.99` or `1299`.
   * Currency is inferred from a glyph/ISO prefix, else `fallbackCurrency`.
   */
  static parse(input: string, fallbackCurrency: string = DEFAULT_CURRENCY): Money {
    if (typeof input !== 'string') {
      throw new ValidationError('Price must be a string');
    }
    let text = input.trim();
    if (text.length === 0) {
      throw new ValidationError('Price string is empty');
    }

    let currency = fallbackCurrency.toUpperCase();
    // ISO code prefix, e.g. "INR 1,299".
    const iso = /^([A-Za-z]{3})\s+(.*)$/.exec(text);
    if (iso?.[1] && iso[2] !== undefined) {
      currency = iso[1].toUpperCase();
      text = iso[2];
    } else {
      for (const [symbol, code] of CURRENCY_SYMBOLS) {
        if (text.includes(symbol)) {
          currency = code;
          text = text.split(symbol).join('');
          break;
        }
      }
    }

    // Remove grouping separators and whitespace.
    text = text.replace(/[\s\u00a0]/g, '').replace(/,/g, '');
    if (text.length === 0) {
      throw new ValidationError(`No numeric value in price "${input}"`);
    }

    const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) {
      throw new ValidationError(`Invalid price format: "${input}"`);
    }

    const negative = match[1] === '-';
    const integerPart = match[2] ?? '0';
    const fractionPart = match[3] ?? '';
    const exponent = currencyExponent(currency);

    if (fractionPart.length > exponent) {
      throw new ValidationError(`Too many decimal places for ${currency}: "${input}"`);
    }

    const padded = fractionPart.padEnd(exponent, '0');
    const minorDigits = exponent > 0 ? `${integerPart}${padded}` : integerPart;
    const minorUnits = Number(minorDigits);
    if (!Number.isSafeInteger(minorUnits)) {
      throw new ValidationError(`Price out of range: "${input}"`);
    }

    return new Money(negative ? -minorUnits : minorUnits, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new ValidationError(`Cannot operate on ${this.currency} and ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  /** -1, 0 or 1. */
  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.minorUnits < other.minorUnits) return -1;
    if (this.minorUnits > other.minorUnits) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  isZero(): boolean {
    return this.minorUnits === 0;
  }

  isNegative(): boolean {
    return this.minorUnits < 0;
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) > 0;
  }

  lessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  /** Absolute value (useful for "changed by" messages). */
  abs(): Money {
    return new Money(Math.abs(this.minorUnits), this.currency);
  }

  /**
   * Signed percentage change from `previous` to `this`, e.g. -12.5 for a 12.5%
   * drop. Returns 0 when `previous` is zero.
   */
  percentageChangeFrom(previous: Money): number {
    this.assertSameCurrency(previous);
    if (previous.minorUnits === 0) return 0;
    return ((this.minorUnits - previous.minorUnits) / Math.abs(previous.minorUnits)) * 100;
  }

  /** Plain major-unit string, e.g. "1299.99". */
  toMajorString(): string {
    const exponent = currencyExponent(this.currency);
    const sign = this.minorUnits < 0 ? '-' : '';
    const absolute = Math.abs(this.minorUnits);
    if (exponent === 0) return `${sign}${absolute}`;
    const base = 10 ** exponent;
    const major = Math.floor(absolute / base);
    const fraction = absolute % base;
    return `${sign}${major}.${String(fraction).padStart(exponent, '0')}`;
  }

  /** Localised display string, e.g. "₹1,299.99". */
  format(locale?: string): string {
    return new Intl.NumberFormat(locale ?? LOCALES[this.currency] ?? 'en-US', {
      style: 'currency',
      currency: this.currency,
      minimumFractionDigits: currencyExponent(this.currency),
    }).format(this.minorUnits / 10 ** currencyExponent(this.currency));
  }

  toString(): string {
    return `${this.toMajorString()} ${this.currency}`;
  }

  toJSON(): { minorUnits: number; currency: string } {
    return { minorUnits: this.minorUnits, currency: this.currency };
  }
}

export interface MoneyJSON {
  minorUnits: number;
  currency: string;
}

export function moneyFromJSON(value: MoneyJSON): Money {
  return Money.fromMinorUnits(value.minorUnits, value.currency);
}
