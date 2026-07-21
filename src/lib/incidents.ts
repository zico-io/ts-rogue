import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type {
  Attempt,
  DebugJournalEntry,
  GameIncident,
  IncidentCategory,
} from "../engine/state/incidents";
import { attempt } from "../engine/state/incidents";
import type { GameStore } from "../engine/state/store";
import type { GameState } from "../engine/state/types";
import { buildIssueBody, type ReportResult, submitReport } from "./linear";

export interface IncidentDisplay {
  incident: GameIncident;
  status: "filing" | ReportResult["status"];
  detail?: string;
}

/** Enforces capture for synchronous failures at application boundaries. */
export class FailureBoundary {
  constructor(private readonly store: GameStore) {}

  run<T>(
    category: IncidentCategory,
    fatal: boolean,
    operation: () => T,
  ): Attempt<T> {
    const result = attempt(operation);
    if (!result.ok) this.report(category, result.error, fatal);
    return result;
  }

  report(
    category: IncidentCategory,
    error: unknown,
    fatal: boolean,
  ): GameIncident {
    return this.store.reportFailure(category, error, fatal);
  }
}

function optional<T>(operation: () => T): T | undefined {
  const result = attempt(operation);
  return result.ok ? result.value : undefined;
}

function gitCommit(): string | undefined {
  return optional(() =>
    execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim(),
  );
}

function readPlayKeys(): string | undefined {
  if (!process.env.TS_ROGUE_PLAY) return undefined;
  return optional(() => readFileSync(".play-keys.log", "utf8") || undefined);
}

function readPlayFrame(): string | undefined {
  if (!process.env.TS_ROGUE_PLAY) return undefined;
  return optional(() =>
    execFileSync("tmux", ["capture-pane", "-t", "rogue", "-p"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
}

function terminalSize(): string | undefined {
  return process.stdout.columns && process.stdout.rows
    ? `${process.stdout.columns}x${process.stdout.rows}`
    : undefined;
}

function issueBody(
  state: GameState,
  journal: readonly DebugJournalEntry[],
  incident?: GameIncident,
  terminal = terminalSize(),
): string {
  return buildIssueBody({
    seed: state.seed,
    scene: state.scene,
    state,
    logTail: state.log.slice(-12),
    debugJournal: journal,
    keySequence: readPlayKeys(),
    frame: readPlayFrame(),
    commit: gitCommit(),
    node: process.version,
    terminal,
    ...(incident
      ? {
          incident: {
            category: incident.category,
            message: incident.message,
            ...(incident.stack ? { stack: incident.stack } : {}),
            ...(incident.triggeringEvent
              ? { triggeringEvent: incident.triggeringEvent }
              : {}),
            fingerprint: incident.fingerprint,
            journal: incident.journal,
          },
        }
      : {}),
  });
}

/** One process-wide incident pipeline for UI state and report submission. */
export class IncidentPipeline {
  private fatal?: IncidentDisplay;
  private readonly listeners = new Set<(display: IncidentDisplay) => void>();

  constructor(private readonly dev: boolean) {}

  getFatal(): IncidentDisplay | undefined {
    return this.fatal;
  }

  subscribe(listener: (display: IncidentDisplay) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  capture(incident: GameIncident): void {
    if (incident.fatal) this.publish({ incident, status: "filing" });
    void submitReport({
      input: {
        title: `[${incident.category}] ${incident.message}`.slice(0, 120),
        label: "bug",
        body: issueBody(incident.state, incident.journal, incident),
      },
      dev: this.dev,
      automatic: true,
      fingerprint: incident.fingerprint,
      recordedAt: incident.occurredAt,
    }).then((result) => {
      if (incident.fatal) {
        this.publish({
          incident,
          status: result.status,
          detail: result.identifier ?? result.error,
        });
      }
    });
  }

  submitManual(
    state: GameState,
    journal: readonly DebugJournalEntry[],
    title: string,
    label: string,
    terminal?: string,
  ): Promise<ReportResult> {
    return submitReport({
      input: {
        title,
        label,
        body: issueBody(state, journal, undefined, terminal),
      },
      dev: this.dev,
    });
  }

  private publish(display: IncidentDisplay): void {
    this.fatal = display;
    for (const listener of this.listeners) listener(display);
  }
}
