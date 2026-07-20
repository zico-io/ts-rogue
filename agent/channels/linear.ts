import { connectLinearCredentials } from "@vercel/connect/eve";
import type { ChannelEvents } from "eve/channels";
import {
  linearChannel,
  renderLinearInputRequests,
  type LinearChannelContext,
} from "eve/channels/linear";

type InputRequests = Parameters<
  NonNullable<ChannelEvents<LinearChannelContext>["input.requested"]>
>[0]["requests"];

const toolLabel = (toolName: string) => {
  const operation = toolName.split("__").at(-1) ?? toolName;
  const labels: Record<string, string> = {
    save_comment: "Post or update a comment",
    save_issue: "Create or update an issue",
  };
  const label = labels[operation] ?? operation.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export const linearInputActivity = (requests: InputRequests) => {
  const rendered = renderLinearInputRequests(requests);
  const marker = rendered.slice(rendered.lastIndexOf("<!-- eve-input:"));
  const options = requests[0]?.options;
  const sharedOptions =
    options?.length &&
    requests.every((request) => JSON.stringify(request.options) === JSON.stringify(options))
      ? options
      : undefined;

  const prompt = requests.every(({ action }) => action.kind === "tool-call")
    ? `${requests.length === 1 ? "Approve this Linear change?" : "Approve these Linear changes?"}\n\n${requests
        .map(({ action }) => `- ${action.kind === "tool-call" ? toolLabel(action.toolName) : "Continue"}`)
        .join("\n")}`
    : requests.length === 1
      ? requests[0]?.prompt
      : rendered;

  return {
    body: sharedOptions ? `${prompt}\n\n${marker}` : rendered,
    ...(sharedOptions
      ? {
          signal: "select" as const,
          signalMetadata: {
            options: sharedOptions.map(({ id, label }) => ({ label, value: id })),
          },
        }
      : {}),
  };
};

const events: ChannelEvents<LinearChannelContext> = {
  async "actions.requested"({ actions }, channel) {
    for (const action of actions) {
      await channel.linear.createActivity({
        action:
          action.kind === "tool-call"
            ? toolLabel(action.toolName)
            : action.kind === "load-skill"
              ? "Load skill"
              : `Delegate to ${action.name}`,
        parameter: "description" in action ? action.description : JSON.stringify(action.input),
        type: "action",
      });
    }
  },
  async "input.requested"({ requests }, channel) {
    const { body, ...options } = linearInputActivity(requests);
    await channel.linear.createActivity({ body, type: "elicitation" }, options);
  },
  async "reasoning.completed"({ reasoning }, channel) {
    if (reasoning) await channel.linear.createActivity({ body: reasoning, type: "thought" });
  },
};

export default linearChannel({
  credentials: connectLinearCredentials("linear/ts-rogue-eve"),
  events,
});
