/** Append the affiliate tag (Amazon only, matching the legacy behaviour). */
export function buildAffiliateUrl(storeId: string, url: string, tag: string): string {
  if (!tag || storeId !== 'amazon') return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('tag', tag);
    return parsed.toString();
  } catch {
    return url;
  }
}
