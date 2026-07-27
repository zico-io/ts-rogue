import { GamePortal } from "./GamePortal";

const CONTROLS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: "↑ ↓ ← →", label: "move" },
  { keys: "Enter", label: "select" },
  { keys: "Esc", label: "back" },
  { keys: "1 – 4", label: "scenes" },
];

export default function Page() {
  return (
    <div className="chamber">
      <header className="masthead">
        <h1 className="wordmark">ts-rogue</h1>
        <p className="tagline">A terminal dungeon crawler</p>
      </header>

      <main className="stage">
        <div className="portalFrame">
          <span className="corner corner-tl" aria-hidden="true" />
          <span className="corner corner-tr" aria-hidden="true" />
          <span className="corner corner-bl" aria-hidden="true" />
          <span className="corner corner-br" aria-hidden="true" />
          <GamePortal />
        </div>
      </main>

      <footer className="legend">
        {CONTROLS.map(({ keys, label }) => (
          <span className="legendItem" key={label}>
            <kbd className="keycap">{keys}</kbd>
            <span className="legendLabel">{label}</span>
          </span>
        ))}
      </footer>
    </div>
  );
}
