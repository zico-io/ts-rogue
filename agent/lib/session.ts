import type { ChannelEvents } from "eve/channels";
import type { SessionContext } from "eve/tools";

import { type PlanEntry, planFromActionResult } from "./agent-plan";
import type { ChannelRenderer } from "./channel";
import { stripLeadingProseHeader } from "./prose";
import type {
  ActionResultData,
  ActionsRequestedData,
  AuthorizationOutcome,
  InputRequest,
  InputRequestedData,
  MessageFinishReason,
} from "./session-event";
import {
  actionLabel,
  actionParameter,
  actionResultText,
  type FailureData,
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
  | { readonly kind: "inputPrompt"; readonly requests: readonly InputRequest[] }
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
  readonly outcome: AuthorizationOutcome;
  readonly reason?: string | null;
}

interface MessageData {
  readonly finishReason?: MessageFinishReason;
  readonly message: string | null;
}

/** A connection slug as a human would say it. */
const connectionDisplayName = (name: string): string =>
  name.replace(/[-_/]+/gu, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());

const authorizationDisplayName = (data: AuthorizationData): string =>
  data.authorization?.displayName ?? connectionDisplayName(data.name);

/** One channel-agnostic definition of how the agent behaves across a turn. */
export class AgentSession<Channel> {
  constructor(private readonly renderer: ChannelRenderer<Channel>) {}

  private render(
    update: SessionUpdate,
    channel: Channel,
    ctx?: SessionContext,
  ): Promise<void> {
    return this.renderer.render(update, channel, ctx);
  }

  private scratch(channel: Channel): SessionScratch {
    return this.renderer.scratch?.(channel) ?? {};
  }

  async turnStarted(channel: Channel, ctx?: SessionContext): Promise<void> {
    this.scratch(channel).pendingToolCallMessage = null;
    await this.render(
      { body: "Working on this.", kind: "thought", transient: true },
      channel,
      ctx,
    );
  }

  async actionsRequested(
    data: Pick<ActionsRequestedData, "actions">,
    channel: Channel,
    ctx?: SessionContext,
  ): Promise<void> {
    const scratch = this.scratch(channel);
    const pending = scratch.pendingToolCallMessage;
    scratch.pendingToolCallMessage = null;
    if (pending) {
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
    data: Pick<InputRequestedData, "requests">,
    channel: Channel,
    ctx?: SessionContext,
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
    ctx?: SessionContext,
  ): Promise<void> {
    const scratch = this.scratch(channel);
    const message = data.message ? stripLeadingProseHeader(data.message) : null;
    if (data.finishReason === "tool-calls") {
      scratch.pendingToolCallMessage = message;
      return;
    }
    scratch.pendingToolCallMessage = null;
    if (message) {
      await this.render({ body: message, kind: "response" }, channel, ctx);
    }
  }

  async actionResult(
    data: Pick<ActionResultData, "error" | "result" | "status">,
    channel: Channel,
    ctx?: SessionContext,
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
    ctx?: SessionContext,
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
    ctx?: SessionContext,
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
    const outcome = data.outcome === "timed-out" ? "timed out" : data.outcome;
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
    ctx?: SessionContext,
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
    ctx?: SessionContext,
  ): Promise<void> {
    await this.render(
      { body: turnFailureBody(data), kind: "error" },
      channel,
      ctx,
    );
  }
}

/** Wires every lifecycle event eve emits to the session that decides what to do with it. */
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
