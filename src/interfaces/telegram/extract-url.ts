const URL_IN_TEXT = /https?:\/\/[^\s]+/i;
const BARE_URL_IN_TEXT = /(?:^|\s)((?:(?:www|m|dl)\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?)/i;

/** Pull the first URL out of free text (legacy messages often had extra words). */
export function extractUrl(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const withScheme = URL_IN_TEXT.exec(trimmed);
  if (withScheme?.[0]) return withScheme[0];
  const bare = BARE_URL_IN_TEXT.exec(trimmed);
  if (bare?.[1]) return bare[1];
  return null;
}
