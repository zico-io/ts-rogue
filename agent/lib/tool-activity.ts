import { isPlainObject, nonEmptyString } from "./narrow";
import { firstNonEmptyLine } from "./prose";

// Pure formatting for action chips; each channel applies its own length limit.

const INLINE_RESULT_MAX = 300;

/** An MCP tool arrives as `server__operation`; the operation is what reads. */
const toolOperation = (toolName: string): string =>
  toolName.split("__").at(-1) ?? toolName;

const OPERATION_LABELS: Record<string, string> = {
  create_issue_label: "Create an issue label",
  save_document: "Create or update a document",
  save_issue: "Create or update an issue",
  save_milestone: "Create or update a milestone",
  save_project: "Create or update a project",
  save_status_update: "Post a project status update",
};

export const toolLabel = (toolName: string) => {
  const operation = toolOperation(toolName);
  const label = OPERATION_LABELS[operation] ?? operation.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
};

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

/** Wraps text in a Markdown fence, only when it actually contains newlines. */
const fenceIfMultiline = (text: string): string => {
  if (!text.includes("\n")) return text;
  return `\`\`\`\n${text}\n\`\`\``;
};

type ParamFormatter = (input: Record<string, unknown>) => string | undefined;

const subagentFormatter =
  (label: string): ParamFormatter =>
  (input) => {
    const message = nonEmptyString(input.message);
    return message === undefined
      ? undefined
      : `${label} - ${firstNonEmptyLine(message)}`;
  };

const PARAMETER_FORMATTERS: Record<string, ParamFormatter> = {
  agent: subagentFormatter("Agent"),
  playtester: subagentFormatter("Playtester"),
  bash: (input) => nonEmptyString(input.command),
  read_file: (input) => {
    const path = nonEmptyString(input.filePath);
    if (path === undefined) return undefined;
    return typeof input.offset === "number" ? `${path}:${input.offset}` : path;
  },
  write_file: (input) => nonEmptyString(input.filePath),
  grep: (input) => {
    const pattern = nonEmptyString(input.pattern);
    if (pattern === undefined) return undefined;
    const glob = nonEmptyString(input.glob);
    return glob === undefined ? pattern : `${pattern} in ${glob}`;
  },
  glob: (input) => nonEmptyString(input.pattern),
  web_fetch: (input) => nonEmptyString(input.url),
  web_search: (input) =>
    nonEmptyString(input.query) ??
    (Array.isArray(input.queries)
      ? nonEmptyString(
          input.queries.filter((q) => typeof q === "string").join(", "),
        )
      : undefined),
  load_skill: (input) => nonEmptyString(input.skill),
  todo: () => "Updated plan",
};

export const toolActionParameter = (
  toolName: string,
  input: unknown,
): string => {
  const formatter = PARAMETER_FORMATTERS[toolOperation(toolName)];
  const formatted = formatter?.(isPlainObject(input) ? input : {});
  // ponytail: unknown/MCP tools fall back to raw JSON; add a formatter above if one reads badly.
  return formatted ?? compactJson(input);
};

const RESULT_NOUNS: Record<string, [one: string, many: string]> = {
  grep: ["match", "matches"],
  glob: ["file", "files"],
  web_search: ["result", "results"],
};

const errorText = (output: unknown): string | undefined => {
  if (typeof output === "string") return firstNonEmptyLine(output);
  if (isPlainObject(output)) {
    const message =
      nonEmptyString(output.message) ??
      nonEmptyString(output.error) ??
      nonEmptyString(output.stderr);
    if (message !== undefined) return firstNonEmptyLine(message);
  }
  return undefined;
};

const bashResult = (output: unknown): string => {
  if (!isPlainObject(output)) return "done";

  const code =
    typeof output.exitCode === "number" ? output.exitCode : undefined;

  const glyph = code === undefined || code === 0 ? "✓" : "✗";

  const parts: string[] = [code === undefined ? "done" : `exit ${code}`];

  const lines = lineCount(nonEmptyString(output.stdout) ?? "");
  if (lines > 0) parts.push(plural(lines, "line", "lines"));
  if (output.truncated === true) parts.push("truncated");
  const summary = parts.join(" · ");

  if (code !== undefined && code !== 0) {
    const stderr = nonEmptyString(output.stderr)?.trim();
    if (stderr) {
      return `${glyph} ${summary}\n${fenceIfMultiline(stderr)}`;
    }
  }
  return `${glyph} ${summary}`;
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

    if (trimmed.includes("\n")) {
      return fenceIfMultiline(trimmed);
    }

    return trimmed.length <= INLINE_RESULT_MAX
      ? trimmed
      : plural(output.length, "char", "chars");
  }

  if (op === "read_file" && isPlainObject(output)) {
    const content = nonEmptyString(output.content);
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
    return message === undefined ? "✗ error" : `✗ ${message}`;
  }
  return rawResult(toolName, output);
};
