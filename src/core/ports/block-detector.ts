export interface BlockDetectionInput {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * Detects a captcha / robot-check / blocked page so the egress pool can penalise
 * the provider that served it and fail over to another.
 */
export interface BlockDetector {
  isBlocked(input: BlockDetectionInput): boolean;
  reason?(input: BlockDetectionInput): string | undefined;
}
