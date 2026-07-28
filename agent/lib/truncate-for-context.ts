const HEAD_LINES = 200;
const TAIL_LINES = 100;
const MAX_CHARS = 40_000;

const count = (n: number): string => n.toLocaleString("en-US");

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
 * Caps a tool result to a head + tail window for the model transcript, so large
 * output stops riding every later round-trip. Distinct from `truncate.ts`, which
 * is the display-only cap for Linear activity chips.
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

  return capChars(result);
};
