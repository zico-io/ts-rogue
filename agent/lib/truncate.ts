export const MAX_ACTIVITY_TEXT_LENGTH = 300;

export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/**
 * Truncate text while preserving a trailing URL intact.
 * If the text ends with a URL (https?://\S+) and naive truncation would cut
 * into or drop the URL, instead truncate the leading portion to keep the full
 * trailing URL intact and respect the max length as closely as possible.
 * ponytail: a URL alone longer than `max` falls through to plain `truncate`
 * (cutting the URL) rather than special-casing it - not worth the extra
 * branch for a case that doesn't occur at MAX_ACTIVITY_TEXT_LENGTH=300.
 */
export const truncatePreservingTrailingUrl = (
  text: string,
  max: number,
): string => {
  if (text.length <= max) return text;

  const urlMatch = text.match(/https?:\/\/\S+$/);
  if (!urlMatch || urlMatch[0].length > max) return truncate(text, max);

  const url = urlMatch[0];
  // Reserve 2 chars for the "… " joiner so the total never exceeds `max`.
  const leadInBudget = max - url.length - 2;
  if (leadInBudget <= 0) return url;

  const leadIn = text.slice(0, text.length - url.length).slice(0, leadInBudget).trimEnd();
  return leadIn.length === 0 ? url : `${leadIn}… ${url}`;
};
