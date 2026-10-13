export interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  fatal(bindings: Record<string, unknown> | string, message?: string): void;
  error(bindings: Record<string, unknown> | string, message?: string): void;
  warn(bindings: Record<string, unknown> | string, message?: string): void;
  info(bindings: Record<string, unknown> | string, message?: string): void;
  debug(bindings: Record<string, unknown> | string, message?: string): void;
  trace(bindings: Record<string, unknown> | string, message?: string): void;
}
