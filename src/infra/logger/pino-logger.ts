import pino, { type Logger as PinoBase } from 'pino';
import { type Logger } from '../../core/ports/logger.js';

export interface PinoLoggerOptions {
  level: string;
  name?: string;
  pretty?: boolean;
}

/** Adapts pino to the {@link Logger} port. */
export class PinoLogger implements Logger {
  constructor(private readonly base: PinoBase) {}

  static create(options: PinoLoggerOptions): PinoLogger {
    const config: pino.LoggerOptions = { level: options.level };
    if (options.name) config.name = options.name;
    return new PinoLogger(pino(config));
  }

  child(bindings: Record<string, unknown>): Logger {
    return new PinoLogger(this.base.child(bindings));
  }

  fatal(bindings: Record<string, unknown> | string, message?: string): void {
    if (typeof bindings === 'string') this.base.fatal(bindings);
    else if (message !== undefined) this.base.fatal(bindings, message);
    else this.base.fatal(bindings);
  }

  error(bindings: Record<string, unknown> | string, message?: string): void {
    if (typeof bindings === 'string') this.base.error(bindings);
    else if (message !== undefined) this.base.error(bindings, message);
    else this.base.error(bindings);
  }

  warn(bindings: Record<string, unknown> | string, message?: string): void {
    if (typeof bindings === 'string') this.base.warn(bindings);
    else if (message !== undefined) this.base.warn(bindings, message);
    else this.base.warn(bindings);
  }

  info(bindings: Record<string, unknown> | string, message?: string): void {
    if (typeof bindings === 'string') this.base.info(bindings);
    else if (message !== undefined) this.base.info(bindings, message);
    else this.base.info(bindings);
  }

  debug(bindings: Record<string, unknown> | string, message?: string): void {
    if (typeof bindings === 'string') this.base.debug(bindings);
    else if (message !== undefined) this.base.debug(bindings, message);
    else this.base.debug(bindings);
  }

  trace(bindings: Record<string, unknown> | string, message?: string): void {
    if (typeof bindings === 'string') this.base.trace(bindings);
    else if (message !== undefined) this.base.trace(bindings, message);
    else this.base.trace(bindings);
  }
}
