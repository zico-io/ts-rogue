// Model-context truncation for large tool outputs (bash stdout/stderr, file
// reads, web fetches). Without this, a big tool result enters the transcript
// verbatim and is re-sent to the model on every subsequent round-trip,
// inflating token cost for output the model has already seen once. This util
// keeps the head and tail - where the actionable content almost always lives
// (a command's first errors and final summary; a file's top and bottom) - and
// elides the middle, telling the model exactly how much was dropped so it can
// re-read a precise range if it truly needs the interior.
//
// This is deliberately SEPARATE from `truncate.ts`: that one produces the
// 300-char Linear activity chip a human skims, this one caps what the model
// reads. Channel `action.result` handlers still receive the full, untruncated
// output, so Linear chips are unaffected by anything here.

export interface TruncateForContextOptions {
  /** Lines kept from the start. Defaults to 200. */
  readonly headLines?: number;
  /** Lines kept from the end. Defaults to 100. */
  readonly tailLines?: number;
  /**
   * Hard character ceiling applied independently of the line budget, so a
   * single enormous line with no newlines is still capped. Defaults to 40,000.
   */
  readonly maxChars?: number;
}

const DEFAULT_HEAD_LINES = 200;
const DEFAULT_TAIL_LINES = 100;
const DEFAULT_MAX_CHARS = 40_000;

const count = (n: number): string => n.toLocaleString("en-US");

// Character-level cap for text that overflows `maxChars` regardless of line
// count (e.g. minified JSON, a base64 blob, one multi-megabyte line). Keeps a
// head and a small tail so both ends stay visible.
const capChars = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  const headChars = Math.ceil((maxChars * 2) / 3);
  const tailChars = maxChars - headChars;
  const head = text.slice(0, headChars);
  const tail = tailChars > 0 ? text.slice(text.length - tailChars) : "";
  const elided = text.length - head.length - tail.length;
  return `${head}\n… [${count(elided)} chars elided — re-read a specific range if needed] …\n${tail}`;
};

/**
 * Caps `text` to a head + tail window for the model transcript. Returns the
 * input unchanged when it is already within both the line budget and the
 * character ceiling. Otherwise keeps `headLines` from the top and `tailLines`
 * from the bottom joined by an elision marker naming how many lines and
 * characters were dropped, then enforces `maxChars` as an independent ceiling.
 */
export const truncateForContext = (
  text: string,
  opts: TruncateForContextOptions = {},
): string => {
  const headLines = opts.headLines ?? DEFAULT_HEAD_LINES;
  const tailLines = opts.tailLines ?? DEFAULT_TAIL_LINES;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;

  const lines = text.split("\n");
  const withinLines = lines.length <= headLines + tailLines;
  const withinChars = text.length <= maxChars;
  if (withinLines && withinChars) return text;

  let result = text;
  if (!withinLines) {
    const head = lines.slice(0, headLines);
    const middle = lines.slice(headLines, lines.length - tailLines);
    const tail = lines.slice(lines.length - tailLines);
    const elidedChars = middle.join("\n").length;
    const marker = `\n… [${count(middle.length)} lines / ${count(elidedChars)} chars elided — re-read a specific range if needed] …\n`;
    result = `${head.join("\n")}${marker}${tail.join("\n")}`;
  }

  // Independent char ceiling: catches a huge single line the line pass left
  // untouched, and a head+tail window whose retained lines are themselves long.
  return capChars(result, maxChars);
};
