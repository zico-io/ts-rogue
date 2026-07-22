/**
 * Browser dev console (ROG-48): open/input/output state plus the same
 * `runDevCommand` interpreter `DevConsole.tsx` uses, so every command
 * behaves identically under either renderer. `main.ts` owns the DOM (a
 * plain overlay div, `render/devConsoleOverlay.ts`) and calls into this
 * class for every keystroke while the console is open; kept free of the
 * DOM so its command handling stays unit-testable without jsdom (this repo
 * has none - see `boot.test.ts`'s doc comment).
 *
 * Mirrors `DevConsole.tsx`'s raw-input handling rather than the shared
 * `Keymap`/`resolveXIntent` screens use - the character space here is
 * unbounded free text, same as the TUI console's own `useInput` closure.
 * Issue/bug filing and the queued-issue flush are TUI-only (they use
 * `src/lib/linear.ts`'s Node `fs`/Vercel Connect I/O, which does not belong
 * in a browser bundle); this stashes them the same way `main.ts` and
 * `input/keyboard.ts` stash save/settings/quit until a browser-appropriate
 * implementation exists.
 */

import type { GameStore } from "../engine/state/store";
import { charFromKey } from "../ui/scene/input";
import { runDevCommand } from "../ui/screens/devConsoleCommands";
import {
  type BrowserKeyEvent,
  normalizeBrowserKey,
} from "./input/normalizeBrowserKey";

export interface BrowserDevConsoleHandlers {
  /** Same `crash <message>` effect the TUI's console wires to `FailureBoundary.report`. */
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

  /** Routes one keydown while the console is open; `` ` `` closes it. */
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

  /** Runs the current input as a command, exactly like the TUI console's Enter handling. */
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
