import { type BlockDetectionInput, type BlockDetector } from '../../core/ports/block-detector.js';

/** Signals that indicate a captcha / robot check / blocked page. */
const GENERIC_SIGNALS: readonly string[] = [
  'captcha',
  'enter the characters you see',
  'are you a human',
  'robot check',
  'unusual traffic',
  'access denied',
  'please verify you are a human',
];

/**
 * Generic block detector plus optional per-store rules. Status 403/429 always
 * counts as a block; 404 explicitly does not (the page genuinely does not exist).
 */
export class CompositeBlockDetector implements BlockDetector {
  private readonly storeRules = new Map<string, BlockDetector>();

  register(storeId: string, detector: BlockDetector): void {
    this.storeRules.set(storeId, detector);
  }

  isBlocked(input: BlockDetectionInput): boolean {
    if (input.status === 403 || input.status === 429) return true;
    const body = input.body.toLowerCase();
    if (GENERIC_SIGNALS.some((signal) => body.includes(signal))) return true;
    for (const detector of this.storeRules.values()) {
      if (detector.isBlocked(input)) return true;
    }
    return false;
  }

  reason(input: BlockDetectionInput): string | undefined {
    if (input.status === 403) return 'status 403';
    if (input.status === 429) return 'status 429 (rate limited)';
    const body = input.body.toLowerCase();
    const signal = GENERIC_SIGNALS.find((candidate) => body.includes(candidate));
    if (signal) return `block page signal "${signal}"`;
    for (const [storeId, detector] of this.storeRules) {
      if (detector.isBlocked(input)) return `store rule (${storeId})`;
    }
    return undefined;
  }
}
