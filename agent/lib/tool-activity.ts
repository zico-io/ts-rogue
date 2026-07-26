import { isPlainObject } from "./is-plain-object";
import { toolOperation } from "./tool-label";
import { MAX_ACTIVITY_TEXT_LENGTH, truncate } from "./truncate";

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const firstLine = (value: string): string =>
  value.split(/\r?\n/, 1)[0] ?? value;

const lineCount = (text: string): number =>
  text.length === 0 ? 0 : text.split(/\r?\n/).length;

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

const compactJson = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
};

type ParamFormatter = (input: Record<string, unknown>) => string | undefined;

const PARAMETER_FORMATTERS: Record<string, ParamFormatter> = {
  bash: (input) => asString(input.command),
  read_file: (input) => {
    const path = asString(input.filePath);
    if (path === undefined) return undefined;
    return typeof input.offset === "number" ? `${path}:${input.offset}` : path;
  },
  write_file: (input) => asString(input.filePath),
  grep: (input) => {
    const pattern = asString(input.pattern);
    if (pattern === undefined) return undefined;
    const glob = asString(input.glob);
    return glob === undefined ? pattern : `${pattern} in ${glob}`;
  },
  glob: (input) => asString(input.pattern),
  web_fetch: (input) => asString(input.url),
  web_search: (input) =>
    asString(input.query) ??
    (Array.isArray(input.queries)
      ? asString(input.queries.filter((q) => typeof q === "string").join(", "))
      : undefined),
  load_skill: (input) => asString(input.skill),

  todo: () => "Updated plan",
};

export const toolActionParameter = (
  toolName: string,
  input: unknown,
): string => {
  const formatter = PARAMETER_FORMATTERS[toolOperation(toolName)];
  const formatted = formatter?.(isPlainObject(input) ? input : {});

  return truncate(formatted ?? compactJson(input), MAX_ACTIVITY_TEXT_LENGTH);
};

const RESULT_NOUNS: Record<string, [one: string, many: string]> = {
  grep: ["match", "matches"],
  glob: ["file", "files"],
  web_search: ["result", "results"],
};

const errorText = (output: unknown): string | undefined => {
  if (typeof output === "string") return asString(firstLine(output.trim()));
  if (isPlainObject(output)) {
    const message =
      asString(output.message) ??
      asString(output.error) ??
      asString(output.stderr);
    if (message !== undefined) return firstLine(message.trim());
  }
  return undefined;
};

const bashResult = (output: unknown): string => {
  if (!isPlainObject(output)) return "done";
  const parts: string[] = [];
  const code =
    typeof output.exitCode === "number" ? output.exitCode : undefined;
  parts.push(code === undefined ? "done" : `exit ${code}`);
  const lines = lineCount(asString(output.stdout) ?? "");
  if (lines > 0) parts.push(plural(lines, "line", "lines"));
  if (output.truncated === true) parts.push("truncated");
  const summary = parts.join(" · ");
  if (code !== undefined && code !== 0) {
    const err = asString(firstLine((asString(output.stderr) ?? "").trim()));
    if (err !== undefined) return `${summary} - ${err}`;
  }
  return summary;
};

const rawResult = (toolName: string, output: unknown): string => {
  const op = toolOperation(toolName);
  if (op === "bash") return bashResult(output);
  if (op === "write_file") return "wrote";
  if (op === "load_skill") return "loaded";
  if (Array.isArray(output)) {
    const [one, many] = RESULT_NOUNS[op] ?? ["item", "items"];
    return plural(output.length, one, many);
  }
  if (typeof output === "string") {
    if (op === "read_file") return plural(lineCount(output), "line", "lines");
    if (op === "web_fetch") return plural(output.length, "char", "chars");
    const trimmed = output.trim();
    if (trimmed.length === 0) return "done";
    return trimmed.length <= MAX_ACTIVITY_TEXT_LENGTH
      ? trimmed
      : plural(output.length, "char", "chars");
  }

  if (op === "read_file" && isPlainObject(output)) {
    const content = asString(output.content);
    if (content !== undefined)
      return plural(lineCount(content), "line", "lines");
  }
  const json = compactJson(output);
  return json.length > 0 ? json : "done";
};

export const toolActionResult = (
  toolName: string,
  output: unknown,
  isError?: boolean,
): string => {
  if (isError === true) {
    const message = errorText(output);
    return truncate(
      message === undefined ? "error" : `error - ${message}`,
      MAX_ACTIVITY_TEXT_LENGTH,
    );
  }
  return truncate(rawResult(toolName, output), MAX_ACTIVITY_TEXT_LENGTH);
};
