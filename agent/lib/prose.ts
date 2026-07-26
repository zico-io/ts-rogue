const LEADING_MARKDOWN_HEADER =
  /^(?:#{1,6}[ \t]+\S[^\r\n]*|\*\*[^*\r\n]+\*\*|__[^_\r\n]+__)[ \t]*(?:\r?\n)+(?:[ \t]*\r?\n)*/u;

export const stripLeadingProseHeader = (message: string): string => {
  const trimmed = message.trim();
  return trimmed.replace(LEADING_MARKDOWN_HEADER, "") || trimmed;
};
