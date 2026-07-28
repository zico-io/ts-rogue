import type { SessionContext } from "eve/tools";

import type { SessionScratch, SessionUpdate } from "./session";

/**
 * What a channel must answer to take part in the shared session lifecycle: how
 * one update appears there, how a human restarts, and where scratch that must
 * outlive a single event is kept.
 *
 * A renderer is a value, not a subclass, so the same one can serve several
 * channels (see `textRenderer`) and be reached from outside a channel handler
 * (see `channel-registry.ts`).
 */
export interface ChannelRenderer<Channel, Ctx = SessionContext> {
  /** Show one update, however this channel shows things. */
  render(update: SessionUpdate, channel: Channel, ctx?: Ctx): Promise<void>;

  /** How a human restarts after an unrecoverable failure, worded for this channel. */
  readonly restartHint: string;

  /**
   * Scratch that survives between events of one session. Omit it and every
   * event gets a fresh, forgetful object - which is right for a channel that
   * never wires the events that flush it. Overriding it to persisted channel
   * state is how a channel opts into buffering.
   */
  scratch?(channel: Channel): SessionScratch;
}

/**
 * One update as a single body of text, or `null` when a text-only channel shows
 * it as nothing: chips, plans, and native prompts have no surface there.
 */
export const textBody = (update: SessionUpdate): string | null => {
  switch (update.kind) {
    case "thought":
    case "response":
    case "error":
      return update.body;
    case "authPrompt":
      return [
        update.body,
        ...(update.url
          ? ["", `[Authorize ${update.displayName}](${update.url})`]
          : []),
      ].join("\n");
    default:
      return null;
  }
};

/** Splits a body into posts of at most `max` characters each. */
export const chunked = (body: string, max: number): readonly string[] => {
  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += max) {
    chunks.push(body.slice(i, i + max));
  }
  return chunks;
};

/**
 * The renderer for channels whose only surface is posted text - GitHub
 * comments, Slack messages, Discord replies. Each supplies its own post-length
 * cap, because that limit belongs to whoever posts.
 *
 * Chips, plans, and prompts render as nothing on purpose: eve's own channel
 * defaults already turn HITL into buttons and turn progress into the platform's
 * typing indicator.
 */
export const textRenderer = <Channel, Ctx = SessionContext>(options: {
  readonly maxLength: number;
  readonly post: (channel: Channel, body: string) => Promise<unknown>;
  readonly restartHint: string;
}): ChannelRenderer<Channel, Ctx> => ({
  restartHint: options.restartHint,
  async render(update: SessionUpdate, channel: Channel): Promise<void> {
    const body = textBody(update);
    if (body === null) return;
    for (const chunk of chunked(body, options.maxLength)) {
      await options.post(channel, chunk);
    }
  },
});
