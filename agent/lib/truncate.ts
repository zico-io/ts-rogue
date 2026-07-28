/** The ellipsis counts toward `max`, so the result never exceeds it. */
export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/**
 * Truncates text while keeping a trailing URL intact.
 * ponytail: a URL alone longer than `max` falls through to plain `truncate`.
 */
export const truncatePreservingTrailingUrl = (
  text: string,
  max: number,
): string => {
  if (text.length <= max) return text;

  const urlMatch = text.match(/https?:\/\/\S+$/);
  if (!urlMatch || urlMatch[0].length > max) return truncate(text, max);

  const url = urlMatch[0];
  const leadInBudget = Math.max(0, max - url.length - 2);
  const leadIn = text
    .slice(0, text.length - url.length)
    .slice(0, leadInBudget)
    .trimEnd();
  return leadIn.length === 0 ? url : `${leadIn}… ${url}`;
};
