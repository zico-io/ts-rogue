export const toolOperation = (toolName: string): string =>
  toolName.split("__").at(-1) ?? toolName;

export const toolLabel = (toolName: string) => {
  const operation = toolOperation(toolName);
  const labels: Record<string, string> = {
    save_issue: "Create or update an issue",
    save_project: "Create or update a project",
    save_milestone: "Create or update a milestone",
    save_document: "Create or update a document",
    save_status_update: "Post a project status update",
    create_issue_label: "Create an issue label",
  };
  const label = labels[operation] ?? operation.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
};
