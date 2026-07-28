const LEADING_MARKDOWN_HEADER =
  /^(?:#{1,6}[ \t]+\S[^\r\n]*|\*\*[^*\r\n]+\*\*|__[^_\r\n]+__)[ \t]*(?:\r?\n)+(?:[ \t]*\r?\n)*/u;

export const stripLeadingProseHeader = (message: string): string => {
  const trimmed = message.trim();
  return trimmed.replace(LEADING_MARKDOWN_HEADER, "") || trimmed;
};

/** The first line with visible content, used to summarize multi-line prose. */
export const firstNonEmptyLine = (value: string): string | undefined => {
  for (const line of value.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
};
