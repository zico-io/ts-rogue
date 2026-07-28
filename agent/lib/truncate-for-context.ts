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

/** Lines kept from the start of an over-long output. */
const HEAD_LINES = 200;

/** Lines kept from its end. */
const TAIL_LINES = 100;

/**
 * Character ceiling enforced independently of the line budget, so a single
 * enormous line with no newlines is still capped.
 */
const MAX_CHARS = 40_000;

const count = (n: number): string => n.toLocaleString("en-US");

// Character-level cap for text that overflows `MAX_CHARS` regardless of line
// count (e.g. minified JSON, a base64 blob, one multi-megabyte line). Keeps a
// head and a small tail so both ends stay visible.
const capChars = (text: string): string => {
  if (text.length <= MAX_CHARS) return text;
  const headChars = Math.ceil((MAX_CHARS * 2) / 3);
  const tailChars = MAX_CHARS - headChars;
  const head = text.slice(0, headChars);
  const tail = tailChars > 0 ? text.slice(text.length - tailChars) : "";
  const elided = text.length - head.length - tail.length;
  return `${head}\n… [${count(elided)} chars elided; re-read a specific range if needed] …\n${tail}`;
};

/**
 * Caps `text` to a head + tail window for the model transcript. Returns the
 * input unchanged when it is already within both the line budget and the
 * character ceiling. Otherwise keeps the first `HEAD_LINES` and the last
 * `TAIL_LINES` joined by an elision marker naming how many lines and characters
 * were dropped, then enforces `MAX_CHARS` as an independent ceiling.
 */
export const truncateForContext = (text: string): string => {
  const lines = text.split("\n");
  const withinLines = lines.length <= HEAD_LINES + TAIL_LINES;
  const withinChars = text.length <= MAX_CHARS;
  if (withinLines && withinChars) return text;

  let result = text;
  if (!withinLines) {
    const head = lines.slice(0, HEAD_LINES);
    const middle = lines.slice(HEAD_LINES, lines.length - TAIL_LINES);
    const tail = lines.slice(lines.length - TAIL_LINES);
    const elidedChars = middle.join("\n").length;
    const marker = `\n… [${count(middle.length)} lines / ${count(elidedChars)} chars elided; re-read a specific range if needed] …\n`;
    result = `${head.join("\n")}${marker}${tail.join("\n")}`;
  }

  // Independent char ceiling: catches a huge single line the line pass left
  // untouched, and a head+tail window whose retained lines are themselves long.
  return capChars(result);
};
