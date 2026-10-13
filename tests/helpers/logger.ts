import { type Logger } from '../../src/core/ports/logger.js';

export interface LogCall {
  level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  bindings: Record<string, unknown> | string;
  message?: string;
}

/** A no-op logger that records every call for assertions. */
export class CapturingLogger implements Logger {
  readonly calls: LogCall[] = [];

  child(): Logger {
    return this;
  }

  private record(
    level: LogCall['level'],
    bindings: Record<string, unknown> | string,
    message?: string,
  ): void {
    this.calls.push({ level, bindings, ...(message !== undefined ? { message } : {}) });
  }

  fatal(bindings: Record<string, unknown> | string, message?: string): void {
    this.record('fatal', bindings, message);
  }

  error(bindings: Record<string, unknown> | string, message?: string): void {
    this.record('error', bindings, message);
  }

  warn(bindings: Record<string, unknown> | string, message?: string): void {
    this.record('warn', bindings, message);
  }

  info(bindings: Record<string, unknown> | string, message?: string): void {
    this.record('info', bindings, message);
  }

  debug(bindings: Record<string, unknown> | string, message?: string): void {
    this.record('debug', bindings, message);
  }

  trace(bindings: Record<string, unknown> | string, message?: string): void {
    this.record('trace', bindings, message);
  }
}

export const silentLogger: Logger = new CapturingLogger();
