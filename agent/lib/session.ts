import type { ChannelEvents } from "eve/channels";
import type { SessionContext } from "eve/tools";

import { type PlanEntry, planFromActionResult } from "./agent-plan";
import {
  authorizationDisplayName,
  authorizationOutcomeLabel,
} from "./authorization";
import type { ChannelRenderer } from "./channel";
import { stripLeadingProseHeader } from "./prose";
import {
  actionLabel,
  actionParameter,
  actionResultText,
  sessionFailureBody,
  turnFailureBody,
} from "./turn-report";

/** What the agent has to say, before a channel decides how to show it. */
export type SessionUpdate =
  | {
      readonly kind: "thought";
      readonly body: string;
      readonly transient?: boolean;
    }
  | { readonly kind: "response"; readonly body: string }
  | {
      readonly kind: "error";
      readonly body: string;
      /** The session is over, not just this turn - a renderer may react to that. */
      readonly fatal?: boolean;
    }
  | {
      readonly kind: "action";
      readonly action: string;
      readonly parameter: string;
      readonly result?: string;
      readonly transient?: boolean;
    }
  | {
      readonly kind: "authPrompt";
      readonly body: string;
      readonly displayName: string;
      readonly url?: string;
    }
  // biome-ignore lint/suspicious/noExplicitAny: eve's input-request shape, passed through untouched
  | { readonly kind: "inputPrompt"; readonly requests: readonly any[] }
  | { readonly kind: "plan"; readonly steps: readonly PlanEntry[] };

/** An announced action still awaiting its result. */
export interface PendingAction {
  readonly action: string;
  readonly parameter: string;
}

/** Scratch the lifecycle carries between events within one session. */
export interface SessionScratch {
  pendingToolCallMessage?: string | null;
  pendingActionsByCallId?: Record<string, PendingAction>;
}

interface FailureData {
  readonly details?: unknown;
  readonly message: string;
}

interface AuthorizationData {
  readonly authorization?: {
    readonly displayName?: string;
    readonly instructions?: string;
    readonly url?: string;
    readonly userCode?: string;
  } | null;
  readonly name: string;
}

interface AuthorizationOutcomeData extends AuthorizationData {
  readonly outcome: string;
  readonly reason?: string | null;
}

interface MessageData {
  readonly finishReason?: string;
  readonly message: string | null;
}

/**
 * One definition of how the agent behaves across a turn: what it says, when it
 * says it, and what it remembers in between. Every channel shares this one
 * instance of those decisions and supplies a `ChannelRenderer` for the single
 * seam where a `SessionUpdate` becomes whatever that channel actually posts.
 *
 * Every decision here is channel-agnostic on purpose. A channel's transport,
 * its native surfaces, and its platform limits (message length, post size)
 * belong in its renderer, not here.
 */
export class AgentSession<Channel, Ctx = SessionContext> {
  constructor(private readonly renderer: ChannelRenderer<Channel, Ctx>) {}

  private render(
    update: SessionUpdate,
    channel: Channel,
    ctx?: Ctx,
  ): Promise<void> {
    return this.renderer.render(update, channel, ctx);
  }

  private scratch(channel: Channel): SessionScratch {
    return this.renderer.scratch?.(channel) ?? {};
  }

  async turnStarted(channel: Channel, ctx?: Ctx): Promise<void> {
    this.scratch(channel).pendingToolCallMessage = null;
    await this.render(
      { body: "Working on this.", kind: "thought", transient: true },
      channel,
      ctx,
    );
  }

  async actionsRequested(
    // biome-ignore lint/suspicious/noExplicitAny: mirrors the union of runtime action request shapes (see turn-report.ts)
    data: { readonly actions: readonly any[] },
    channel: Channel,
    ctx?: Ctx,
  ): Promise<void> {
    const scratch = this.scratch(channel);
    const pending = scratch.pendingToolCallMessage;
    scratch.pendingToolCallMessage = null;
    if (pending) {
      // Durable, not transient - see HAR-68.
      await this.render({ body: pending, kind: "thought" }, channel, ctx);
    }
    if (data.actions.length === 0) return;
    if (data.actions.length > 1) {
      await this.render(
        {
          action: "Running",
          kind: "action",
          parameter: data.actions.map(actionLabel).join(", "),
          transient: true,
        },
        channel,
        ctx,
      );
      return;
    }
    for (const action of data.actions) {
      const label = actionLabel(action);
      const parameter = actionParameter(action);
      if (
        action.kind === "tool-call" ||
        action.kind === "subagent-call" ||
        action.kind === "remote-agent-call"
      ) {
        scratch.pendingActionsByCallId = {
          ...(scratch.pendingActionsByCallId ?? {}),
          [action.callId]: { action: label, parameter },
        };
      }
      await this.render(
        { action: label, kind: "action", parameter, transient: true },
        channel,
        ctx,
      );
    }
  }

  async inputRequested(
    // biome-ignore lint/suspicious/noExplicitAny: eve's input-request shape, passed through untouched
    data: { readonly requests: readonly any[] },
    channel: Channel,
    ctx?: Ctx,
  ): Promise<void> {
    await this.render(
      { kind: "inputPrompt", requests: data.requests },
      channel,
      ctx,
    );
  }

  async messageCompleted(
    data: MessageData,
    channel: Channel,
    ctx?: Ctx,
  ): Promise<void> {
    const scratch = this.scratch(channel);
    const message = data.message ? stripLeadingProseHeader(data.message) : null;
    if (data.finishReason === "tool-calls") {
      // Keep the full narration, not just its first line (HAR-78). This text
      // is often the substantive content - e.g. a scoping proposal enumerating
      // the tickets about to be created - immediately ahead of an
      // `ask_question` confirmation. Once HAR-68 made it durable, a one-line
      // summary permanently discarded the rest instead of merely flashing
      // past; the human approving the gate never saw the structure they were
      // asked to confirm.
      scratch.pendingToolCallMessage = message;
      return;
    }
    scratch.pendingToolCallMessage = null;
    if (message) {
      await this.render({ body: message, kind: "response" }, channel, ctx);
    }
  }

  async actionResult(
    data: {
      readonly error?: { readonly message?: string } | null;
      readonly status?: string;
      // biome-ignore lint/suspicious/noExplicitAny: mirrors the union of runtime action result shapes
      readonly result: any;
    },
    channel: Channel,
    ctx?: Ctx,
  ): Promise<void> {
    const steps = planFromActionResult(data);
    if (steps !== null) {
      await this.render({ kind: "plan", steps }, channel, ctx);
    }

    if (
      data.result.kind !== "tool-result" &&
      data.result.kind !== "subagent-result"
    ) {
      return;
    }
    const scratch = this.scratch(channel);
    const pending = scratch.pendingActionsByCallId?.[data.result.callId];
    if (!pending) return;

    const { [data.result.callId]: _, ...rest } =
      scratch.pendingActionsByCallId ?? {};
    scratch.pendingActionsByCallId = rest;
    // Durable, not transient: the paired chip is the turn's audit record of
    // what actually ran (HAR-45).
    await this.render(
      {
        action: pending.action,
        kind: "action",
        parameter: pending.parameter,
        result: actionResultText(data),
      },
      channel,
      ctx,
    );
  }

  async authorizationRequired(
    data: AuthorizationData,
    channel: Channel,
    ctx?: Ctx,
  ): Promise<void> {
    const challenge = data.authorization;
    const displayName = authorizationDisplayName(data);
    await this.render(
      {
        body: [
          `I need ${displayName} connected before I can continue.`,
          ...(challenge?.instructions ? ["", challenge.instructions] : []),
          ...(challenge?.userCode
            ? ["", `Code: \`${challenge.userCode}\``]
            : []),
        ].join("\n"),
        displayName,
        kind: "authPrompt",
        ...(challenge?.url === undefined ? {} : { url: challenge.url }),
      },
      channel,
      ctx,
    );
  }

  async authorizationCompleted(
    data: AuthorizationOutcomeData,
    channel: Channel,
    ctx?: Ctx,
  ): Promise<void> {
    const displayName = authorizationDisplayName(data);
    if (data.outcome === "authorized") {
      await this.render(
        {
          body: `Connected to ${displayName}. Resuming.`,
          kind: "thought",
          transient: true,
        },
        channel,
        ctx,
      );
      return;
    }
    const outcome = authorizationOutcomeLabel(data.outcome);
    await this.render(
      {
        body: `Authorization for ${displayName} ${outcome}${data.reason ? `: ${data.reason}` : "."}`,
        kind: "thought",
      },
      channel,
      ctx,
    );
  }

  /** An unrecoverable session: the human needs a fresh one, not a retry. */
  async sessionFailed(
    data: FailureData,
    channel: Channel,
    ctx?: Ctx,
  ): Promise<void> {
    await this.render(
      {
        body: sessionFailureBody(data, this.renderer.restartHint),
        fatal: true,
        kind: "error",
      },
      channel,
      ctx,
    );
  }

  async turnFailed(
    data: FailureData,
    channel: Channel,
    ctx?: Ctx,
  ): Promise<void> {
    await this.render(
      { body: turnFailureBody(data), kind: "error" },
      channel,
      ctx,
    );
  }
}

/**
 * Wires every lifecycle event eve emits to the session that decides what to do
 * with it. One table for every channel: the event names are eve's, not any one
 * platform's.
 *
 * A channel that wants less spreads this and nulls a key -
 * `{ ...sessionEvents(session), "input.requested": undefined }` - because eve's
 * adapter builder registers only truthy handlers.
 */
export const sessionEvents = <Channel>(
  session: AgentSession<Channel>,
): ChannelEvents<Channel> => ({
  "action.result": (data, channel, ctx) =>
    session.actionResult(data, channel, ctx),
  "actions.requested": (data, channel, ctx) =>
    session.actionsRequested(data, channel, ctx),
  "authorization.completed": (data, channel, ctx) =>
    session.authorizationCompleted(data, channel, ctx),
  "authorization.required": (data, channel, ctx) =>
    session.authorizationRequired(data, channel, ctx),
  "input.requested": (data, channel, ctx) =>
    session.inputRequested(data, channel, ctx),
  "message.completed": (data, channel, ctx) =>
    session.messageCompleted(data, channel, ctx),
  // eve hands `session.failed` no `SessionContext` - the session is already gone.
  "session.failed": (data, channel) => session.sessionFailed(data, channel),
  "turn.failed": (data, channel, ctx) => session.turnFailed(data, channel, ctx),
  "turn.started": (_data, channel, ctx) => session.turnStarted(channel, ctx),
});
