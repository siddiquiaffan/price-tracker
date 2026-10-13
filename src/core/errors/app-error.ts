export interface AppErrorOptions {
  userMessage?: string;
  retryable?: boolean;
  cause?: unknown;
}

/**
 * Base class for all application errors. `message` is internal (goes to logs);
 * `userMessage` is safe to show to end users (Telegram / API clients).
 */
export class AppError extends Error {
  override readonly name: string = 'AppError';
  readonly userMessage: string;
  readonly retryable: boolean;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.userMessage = options.userMessage ?? message;
    this.retryable = options.retryable ?? false;
  }
}

/** A scrape failed for a reason that is not the store's fault (timeout, network). */
export class ScrapeError extends AppError {
  override readonly name: string = 'ScrapeError';
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      userMessage: "Sorry, I couldn't reach the store right now.",
      retryable: true,
      ...options,
    });
  }
}

/** The page was fetched but could not be parsed (selectors changed, no price). */
export class ParseError extends AppError {
  override readonly name: string = 'ParseError';
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      userMessage: "Sorry, I couldn't read the product details.",
      retryable: false,
      ...options,
    });
  }
}

/** A captcha / robot-check / blocked page was detected. Retryable on another egress. */
export class BlockDetectedError extends ScrapeError {
  override readonly name: string = 'BlockDetectedError';
  constructor(message = 'Blocked by the store (captcha or robot check).') {
    super(message, {
      userMessage: 'Sorry, the store is blocking us right now. Please try again later.',
    });
  }
}

/** Every egress provider failed for a request. */
export class AllEgressFailedError extends AppError {
  override readonly name: string = 'AllEgressFailedError';
  constructor(
    message: string,
    readonly attempts: readonly { providerId: string; reason: string }[],
    options: AppErrorOptions = {},
  ) {
    super(message, {
      userMessage: "Sorry, we couldn't reach the store right now.",
      retryable: true,
      ...options,
    });
  }
}

export class UnsupportedStoreError extends AppError {
  override readonly name: string = 'UnsupportedStoreError';
  constructor(message = 'No store matches this link.', options: AppErrorOptions = {}) {
    super(message, {
      userMessage:
        "Sorry, I can't track this product. Cuz the link you sent is not a amazon or flipkart product link.",
      ...options,
    });
  }
}

export class LimitExceededError extends AppError {
  override readonly name: string = 'LimitExceededError';
  constructor(
    message = 'Tracking limit exceeded.',
    readonly limit?: number,
    options: AppErrorOptions = {},
  ) {
    super(message, {
      userMessage:
        "I'm sorry, but you can't add more products as you've already reached the maximum limit.\n\nPlease delete atleast one product. And try again.\n\nTo get list send /list",
      ...options,
    });
  }
}

export class NotFoundError extends AppError {
  override readonly name: string = 'NotFoundError';
  constructor(message = 'Resource not found.', options: AppErrorOptions = {}) {
    super(message, { userMessage: message, ...options });
  }
}

export class NotAllowedError extends AppError {
  override readonly name: string = 'NotAllowedError';
  constructor(message = 'Operation not allowed.', options: AppErrorOptions = {}) {
    super(message, { userMessage: message, ...options });
  }
}

export class ValidationError extends AppError {
  override readonly name: string = 'ValidationError';
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { userMessage: message, ...options });
  }
}

export class InvalidUrlError extends AppError {
  override readonly name: string = 'InvalidUrlError';
  constructor(message = 'Not a valid product URL.', options: AppErrorOptions = {}) {
    super(message, {
      userMessage: "Sorry, I can't track this product. Make sure you've sent correct product link.",
      ...options,
    });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
