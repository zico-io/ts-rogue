import type { SessionContext } from "eve/tools";

import type { SessionScratch, SessionUpdate } from "./session";

/** What a channel must answer to take part in the shared session lifecycle. */
export interface ChannelRenderer<Channel> {
  /** Show one update, however this channel shows things. */
  render(
    update: SessionUpdate,
    channel: Channel,
    ctx?: SessionContext,
  ): Promise<void>;

  /** How a human restarts after an unrecoverable failure, worded for this channel. */
  readonly restartHint?: string;

  /** Scratch that survives between events of one session. */
  scratch?(channel: Channel): SessionScratch;
}

/** One update as a single body of text, or `null` when this channel shows it as nothing. */
const textBody = (update: SessionUpdate): string | null => {
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
const chunked = (body: string, max: number): readonly string[] => {
  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += max) {
    chunks.push(body.slice(i, i + max));
  }
  return chunks;
};

/** The renderer for channels whose only surface is posted text. */
export const textRenderer = <Channel>(options: {
  readonly maxLength: number;
  readonly post: (channel: Channel, body: string) => Promise<unknown>;
  readonly restartHint?: string;
}): ChannelRenderer<Channel> => ({
  ...(options.restartHint === undefined
    ? {}
    : { restartHint: options.restartHint }),
  async render(update: SessionUpdate, channel: Channel): Promise<void> {
    const body = textBody(update);
    if (body === null) return;
    for (const chunk of chunked(body, options.maxLength)) {
      await options.post(channel, chunk);
    }
  },
});
