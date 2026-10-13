/** Injectable time source so all time-based logic is testable with a fake clock. */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
