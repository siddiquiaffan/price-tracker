import { type Clock } from '../../src/core/ports/clock.js';

/** A clock whose time can be advanced deterministically. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start = new Date('2024-01-01T00:00:00.000Z')) {
    this.current = start;
  }

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = date;
  }
}
