import type { GameState } from "../../engine/state/types";
import { theme } from "../../ui/theme";

export class DevConsoleOverlayView {
  private readonly root: HTMLDivElement;
  private readonly log: HTMLPreElement;
  private readonly prompt: HTMLDivElement;

  constructor(mount: HTMLElement) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "absolute",
      inset: "0",
      display: "none",
      flexDirection: "column",
      padding: "1em",
      background: "#000",
      color: theme.text,
      fontFamily: "monospace",
      fontSize: "14px",
      zIndex: "900",
    });

    const heading = document.createElement("div");
    heading.textContent = "Game Console";
    heading.style.fontWeight = "bold";
    this.root.appendChild(heading);

    const hint = document.createElement("div");
    hint.textContent = "Press ` to return to the game. Run help for commands.";
    hint.style.color = theme.textMuted;
    hint.style.marginBottom = "0.5em";
    this.root.appendChild(hint);

    this.log = document.createElement("pre");
    Object.assign(this.log.style, {
      flex: "1",
      overflow: "auto",
      whiteSpace: "pre-wrap",
      margin: "0",
    });
    this.root.appendChild(this.log);

    this.prompt = document.createElement("div");
    this.prompt.style.marginTop = "0.5em";
    this.root.appendChild(this.prompt);

    mount.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? "flex" : "none";
  }

  render(state: GameState, output: readonly string[], input: string): void {
    const lines = [
      ...state.log.map((line) => `[game] ${line.text}`),
      ...output,
    ];
    this.log.textContent = lines.slice(-200).join("\n");
    this.log.scrollTop = this.log.scrollHeight;
    this.prompt.textContent = `> ${input}`;
  }
}
