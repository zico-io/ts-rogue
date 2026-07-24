/**
 * Plain-DOM crash overlay (ROG-48): the browser counterpart to the
 * terminal's `CrashScreen.tsx`, replacing `main.ts`'s earlier plain-text
 * `showCrash` stash for every failure after the store exists. A DOM overlay
 * is enough here (see the issue's ponytail note) - this is not a Pixi view,
 * so unlike `render/sceneView.ts` it is not unit-tested against a fake
 * `DrawFactory`; it's thin DOM glue, like `atlas.ts`/`pixiDrawFactory.ts`,
 * and this repo has no jsdom to exercise real `document` APIs in a test.
 */

import type { GameIncident } from "../../engine/state/incidents";
import { theme } from "../../ui/theme";

export class CrashOverlayView {
  private readonly root: HTMLDivElement;
  private readonly heading: HTMLDivElement;
  private readonly body: HTMLPreElement;

  constructor(mount: HTMLElement, onRestart: () => void) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      // `absolute` (not `fixed`) so the overlay fills the portal mount it is
      // appended to, not the whole viewport (ROG-54).
      position: "absolute",
      inset: "0",
      display: "none",
      flexDirection: "column",
      alignItems: "flex-start",
      justifyContent: "center",
      padding: "2em",
      background: "rgba(0, 0, 0, 0.92)",
      color: theme.text,
      fontFamily: "monospace",
      zIndex: "1000",
    });

    this.heading = document.createElement("div");
    Object.assign(this.heading.style, {
      color: theme.danger,
      fontWeight: "bold",
      fontSize: "1.1em",
      marginBottom: "0.5em",
    });
    this.root.appendChild(this.heading);

    this.body = document.createElement("pre");
    Object.assign(this.body.style, {
      whiteSpace: "pre-wrap",
      maxWidth: "80ch",
      margin: "0 0 1em 0",
    });
    this.root.appendChild(this.body);

    const restart = document.createElement("button");
    restart.textContent = "Restart";
    Object.assign(restart.style, {
      font: "inherit",
      padding: "0.5em 1.5em",
      cursor: "pointer",
    });
    restart.addEventListener("click", onRestart);
    this.root.appendChild(restart);

    mount.appendChild(this.root);
  }

  show(incident: GameIncident): void {
    this.heading.textContent = `Unexpected game failure (${incident.category})`;
    const journalTail = incident.journal
      .slice(-5)
      .map((entry) =>
        `  [${entry.kind}] ${entry.event ?? entry.message ?? ""}`.trimEnd(),
      )
      .join("\n");
    this.body.textContent = [
      incident.message,
      `Fingerprint: ${incident.fingerprint}`,
      "The last valid game state was preserved.",
      "",
      "Incident journal (most recent):",
      journalTail || "  (empty)",
    ].join("\n");
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }
}
