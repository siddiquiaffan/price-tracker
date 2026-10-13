import { type BlockDetectionInput, type BlockDetector } from '../../core/ports/block-detector.js';

/**
 * Flipkart serves 200-status bot-check / "Something went wrong" retry pages
 * (the `batman-returns` challenge shell) that carry a decoy `og:title` but no
 * product content — no JSON-LD, no `#container` SPA root, no price. The
 * generic detector only knows captcha-style text, so those pages slipped
 * through and were parsed into price-less decoy products.
 *
 * The retry-page family is identifiable by its template markers (verified
 * against a live capture: `retry_btn` wired to `window.location.reload()`,
 * plus the `errorImg` SVG placeholder).
 */
const RETRY_PAGE_MARKERS: readonly string[] = ['retry_btn', 'reload_btn', 'errorimg'];

export class FlipkartBlockDetector implements BlockDetector {
  isBlocked(input: BlockDetectionInput): boolean {
    const body = input.body.toLowerCase();
    return RETRY_PAGE_MARKERS.some((marker) => body.includes(marker));
  }

  reason(input: BlockDetectionInput): string | undefined {
    return this.isBlocked(input) ? 'flipkart retry/challenge page' : undefined;
  }
}
