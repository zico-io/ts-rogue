/** Bare tool operation, minus any `connection__tool` MCP prefix (e.g. `linear__save_issue` -> `save_issue`). */
export const toolOperation = (toolName: string): string =>
  toolName.split("__").at(-1) ?? toolName;

export const toolLabel = (toolName: string) => {
  const operation = toolOperation(toolName);
  const labels: Record<string, string> = {
    save_issue: "Create or update an issue",
    save_project: "Create or update a project",
  };
  const label = labels[operation] ?? operation.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
};
