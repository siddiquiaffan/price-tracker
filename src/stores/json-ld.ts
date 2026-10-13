/** Extract and parse all `application/ld+json` blocks from an HTML document. */
export function extractJsonLd(html: string): unknown[] {
  const results: unknown[] = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const content = match[1]?.trim();
    if (!content) continue;
    try {
      results.push(JSON.parse(content));
    } catch {
      // Ignore malformed JSON-LD blocks and fall back to selectors.
    }
  }
  return results;
}

export type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeMatches(value: unknown, wanted: string): boolean {
  if (typeof value === 'string') return value.toLowerCase() === wanted.toLowerCase();
  if (Array.isArray(value)) return value.some((item) => typeMatches(item, wanted));
  return false;
}

function collectCandidates(value: unknown, wanted: string, out: JsonObject[], depth = 0): void {
  if (depth > 6) return;
  if (Array.isArray(value)) {
    for (const item of value) collectCandidates(item, wanted, out, depth + 1);
    return;
  }
  if (!isObject(value)) return;
  if (typeMatches(value['@type'], wanted)) out.push(value);
  const graph = value['@graph'];
  if (graph !== undefined) collectCandidates(graph, wanted, out, depth + 1);
}

/** Find the first JSON-LD node whose `@type` is (or includes) `wanted`. */
export function findJsonLdNode(html: string, wanted: string): JsonObject | null {
  const candidates: JsonObject[] = [];
  for (const block of extractJsonLd(html)) {
    collectCandidates(block, wanted, candidates);
  }
  return candidates[0] ?? null;
}

export function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Normalise JSON-LD `offers` (object or array) into a flat lookup. */
export function normalizeOffers(offers: unknown): JsonObject | null {
  if (Array.isArray(offers)) {
    const first = offers.find((item) => isObject(item));
    return isObject(first) ? first : null;
  }
  return isObject(offers) ? offers : null;
}

export function offerField(offers: unknown, key: string): unknown {
  const offer = normalizeOffers(offers);
  return offer?.[key];
}
