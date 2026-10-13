import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FlipkartBlockDetector } from '../../src/stores/flipkart/block-detector.js';
import { CompositeBlockDetector } from '../../src/infra/egress/block-detector.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/flipkart/${name}`, import.meta.url)), 'utf8');

const JSON_LD_PRODUCT = `<html><head>
  <script type="application/ld+json">{"@type":"Product","name":"vivo V80 (Sunrise Anthem, 128 GB) 8 GB RAM, 128 GB ROM Mobile Phone","offers":{"price":62999,"priceCurrency":"INR","availability":"https://schema.org/InStock"}}</script>
  <meta property="og:title" content="vivo V80 (128 GB Storage, 8 GB RAM) Online at Best Price On Flipkart.com">
</head><body><div id="container"><div class="_1psv1zeb9">&#8377;62,999</div></div></body></html>`;

describe('FlipkartBlockDetector', () => {
  const detector = new FlipkartBlockDetector();

  it('flags 200-status retry/challenge pages (decoy title, no product data)', () => {
    const challenge = fixture('challenge-retry.html');
    expect(detector.isBlocked({ status: 200, body: challenge, headers: {} })).toBe(true);
    expect(detector.reason({ status: 200, body: challenge, headers: {} })).toBe(
      'flipkart retry/challenge page',
    );
  });

  it('flags zero-length and marker-only decoy bodies', () => {
    expect(
      detector.isBlocked({
        status: 200,
        body: '<button id="reload_btn">reload</button>',
        headers: {},
      }),
    ).toBe(true);
    expect(
      detector.isBlocked({
        status: 200,
        body: `<svg class="errorImg"></svg><title>Some product</title>`,
        headers: {},
      }),
    ).toBe(true);
  });

  it('lets real product pages through', () => {
    expect(detector.isBlocked({ status: 200, body: JSON_LD_PRODUCT, headers: {} })).toBe(false);
    expect(detector.reason({ status: 200, body: JSON_LD_PRODUCT, headers: {} })).toBeUndefined();
    expect(
      detector.isBlocked({ status: 200, body: '<span>a normal checkout page</span>', headers: {} }),
    ).toBe(false);
  });
});

describe('CompositeBlockDetector with the Flipkart rule', () => {
  it('catches a flipkart challenge page that has no captcha-style text', () => {
    const detector = new CompositeBlockDetector();
    detector.register('flipkart', new FlipkartBlockDetector());
    const challenge = fixture('challenge-retry.html');
    expect(challenge.toLowerCase()).not.toContain('captcha');
    expect(detector.isBlocked({ status: 200, body: challenge, headers: {} })).toBe(true);
    expect(detector.reason({ status: 200, body: challenge, headers: {} })).toBe(
      'store rule (flipkart)',
    );
  });

  it('does not flag a genuine flipkart product page', () => {
    const detector = new CompositeBlockDetector();
    detector.register('flipkart', new FlipkartBlockDetector());
    expect(detector.isBlocked({ status: 200, body: JSON_LD_PRODUCT, headers: {} })).toBe(false);
  });

  it('does not false-positive on real pages embedding "captcha" (isReCaptchaEnabled)', () => {
    // Regression: Flipkart product pages ship `"isReCaptchaEnabled":true` in
    // their config JSON — the old bare-substring signal flagged every real
    // page as blocked. Word-boundary matching must let them through.
    const detector = new CompositeBlockDetector();
    const body = 'window.__CONFIG__ = {"isReCaptchaEnabled":true,"isLivestreamModeration":false};';
    expect(detector.isBlocked({ status: 200, body, headers: {} })).toBe(false);
    expect(detector.reason({ status: 200, body, headers: {} })).toBeUndefined();
  });

  it('still blocks standalone challenge text mentioning captcha', () => {
    const detector = new CompositeBlockDetector();
    expect(
      detector.isBlocked({
        status: 200,
        body: '<p>Please complete the captcha to continue.</p>',
        headers: {},
      }),
    ).toBe(true);
  });
});
