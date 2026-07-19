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

export const linearInputActivity = (requests: InputRequests) => {
  const rendered = renderLinearInputRequests(requests);
  const marker = rendered.slice(rendered.lastIndexOf("<!-- eve-input:"));
  const options = requests[0]?.options;
  const sharedOptions =
    options?.length &&
    requests.every((request) => JSON.stringify(request.options) === JSON.stringify(options))
      ? options
      : undefined;

  const prompt =
    requests.length === 1
      ? requests[0]?.prompt
      : `Approve these tool calls?\n\n${requests
          .map(({ prompt }) => `- ${prompt.replace("Approve tool call: ", "")}`)
          .join("\n")}`;

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
            ? action.toolName
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
