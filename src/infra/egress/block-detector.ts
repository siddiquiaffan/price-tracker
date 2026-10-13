import { type BlockDetectionInput, type BlockDetector } from '../../core/ports/block-detector.js';

/**
 * Signals that indicate a captcha / robot check / blocked page. Regexes, not
 * substrings: bare `body.includes('captcha')` false-positives on real pages
 * that merely embed the word — Flipkart's product pages legitimately ship
 * `"isReCaptchaEnabled":true` in their config JSON and were being flagged as
 * blocked on every request. `\bcaptcha\b` still matches standalone challenge
 * text ("complete the captcha", `alt="captcha"`) but not camelCase config keys.
 */
const GENERIC_SIGNALS: readonly RegExp[] = [
  /\bcaptcha\b/i,
  /enter the characters you see/i,
  /are you a human/i,
  /robot check/i,
  /unusual traffic/i,
  /access denied/i,
  /please verify you are a human/i,
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
    if (GENERIC_SIGNALS.some((signal) => signal.test(body))) return true;
    for (const detector of this.storeRules.values()) {
      if (detector.isBlocked(input)) return true;
    }
    return false;
  }

  reason(input: BlockDetectionInput): string | undefined {
    if (input.status === 403) return 'status 403';
    if (input.status === 429) return 'status 429 (rate limited)';
    const body = input.body.toLowerCase();
    const signal = GENERIC_SIGNALS.find((candidate) => candidate.test(body));
    if (signal) return `block page signal "${signal.source}"`;
    for (const [storeId, detector] of this.storeRules) {
      if (detector.isBlocked(input)) return `store rule (${storeId})`;
    }
    return undefined;
  }
}
