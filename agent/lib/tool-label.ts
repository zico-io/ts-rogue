export const toolLabel = (toolName: string) => {
  const operation = toolName.split("__").at(-1) ?? toolName;
  const labels: Record<string, string> = {
    save_issue: "Create or update an issue",
  };
  const label = labels[operation] ?? operation.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
};
