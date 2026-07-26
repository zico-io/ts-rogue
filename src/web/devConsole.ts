import type { GameStore } from "../engine/state/store";
import { charFromKey } from "../ui/scene/input";
import { runDevCommand } from "../ui/screens/devConsoleCommands";
import {
  type BrowserKeyEvent,
  normalizeBrowserKey,
} from "./input/normalizeBrowserKey";

export interface BrowserDevConsoleHandlers {
  crash: (message: string) => void;
}

export class BrowserDevConsole {
  private open = false;
  private input = "";
  private output: string[] = [];

  constructor(
    private readonly store: GameStore,
    private readonly handlers: BrowserDevConsoleHandlers,
  ) {}

  isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.open = !this.open;
  }

  getInput(): string {
    return this.input;
  }

  getOutput(): readonly string[] {
    return this.output;
  }

  handleKeyDown(event: BrowserKeyEvent): void {
    const keyName = normalizeBrowserKey(event);
    if (!keyName) return;
    if (keyName === "`") {
      this.toggle();
      return;
    }
    if (keyName === "enter") {
      this.submit();
      return;
    }
    if (keyName === "backspace") {
      this.input = this.input.slice(0, -1);
      return;
    }
    const char = charFromKey(keyName);
    if (char !== undefined) this.input += char;
  }

  private submit(): void {
    const command = this.input;
    const result = runDevCommand(
      command,
      this.store.getState(),
      this.store.getDebugJournal(),
    );
    if (result.event) this.store.dispatch(result.event);
    let output = result.clear
      ? []
      : [...this.output, `> ${command}`, ...result.output];
    if (result.createIssue || result.flushIssues) {
      output = [...output, "Issue filing isn't available in the browser yet."];
    }
    this.output = output;
    if (result.crash) this.handlers.crash(result.crash);
    this.input = "";
  }
}
