export const MAX_ACTIVITY_TEXT_LENGTH = 300;

export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/**
 * Truncate text while preserving a trailing URL intact.
 * If the text ends with a URL (https?://\S+) and naive truncation would cut
 * into or drop the URL, instead truncate the leading portion to keep the full
 * trailing URL intact and respect the max length as closely as possible.
 */
export const truncatePreservingTrailingUrl = (
  text: string,
  max: number,
): string => {
  if (text.length <= max) return text;

  // Check if text ends with a URL
  const urlMatch = text.match(/https?:\/\/\S+$/);
  if (!urlMatch) {
    // No trailing URL, use standard truncation
    return truncate(text, max);
  }

  const url = urlMatch[0];
  const beforeUrl = text.slice(0, text.length - url.length);

  // If URL alone is longer than max, just use standard truncation
  // (this is an edge case where we can't satisfy both constraints)
  if (url.length > max) {
    return truncate(text, max);
  }

  // Truncate the leading portion to fit total within max
  const maxBeforeUrl = max - url.length;
  if (maxBeforeUrl <= 0) {
    // Just the URL fits
    return url;
  }

  const truncatedBefore = beforeUrl.slice(0, maxBeforeUrl).trimEnd();
  if (truncatedBefore.length === 0) {
    return url;
  }

  // Add ellipsis only before URL if we truncated
  return `${truncatedBefore}… ${url}`;
};
