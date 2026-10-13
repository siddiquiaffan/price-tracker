# Test fixtures

HTML captures used by parser and store contract tests. **These are sanitised.**

## Amazon (`amazon/`)

| File | Variant | Source | Captured |
|------|---------|--------|----------|
| `in-stock-jsonld.html` | in stock, JSON-LD | synthetic (JSON-LD shape from schema.org Product) | 2026-10-13 |
| `in-stock-css.html` | in stock, CSS selectors only | synthetic | 2026-10-13 |
| `deal-price.html` | deal price + list price | synthetic | 2026-10-13 |
| `out-of-stock.html` | out of stock, no price | synthetic | 2026-10-13 |
| `no-price.html` | title present, price hidden | synthetic | 2026-10-13 |
| `captcha.html` | robot check page | synthetic | 2026-10-13 |

## Flipkart (`flipkart/`)

| File | Variant | Source | Captured |
|------|---------|--------|----------|
| `in-stock-jsonld.html` | in stock, JSON-LD | synthetic | 2026-10-13 |
| `in-stock-css.html` | in stock, CSS selectors only | synthetic | 2026-10-13 |
| `out-of-stock.html` | out of stock | synthetic | 2026-10-13 |
| `no-price.html` | title present, price hidden | synthetic | 2026-10-13 |
| `captcha.html` | robot check page | synthetic | 2026-10-13 |

> **NEEDS VERIFICATION**: these fixtures are synthetic placeholders that exercise the
> parser contract. Before shipping, replace them with real captured pages and update
> the source URL + capture date, then verify the selectors in
> `src/stores/*/selectors.ts` still match. Personal data and tracking parameters must
> be stripped from any real capture.
