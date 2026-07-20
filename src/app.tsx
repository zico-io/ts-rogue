import { render } from "ink";
import { GameStore, newGame } from "./engine/state/store.js";
import { App } from "./ui/App.js";

/**
 * Process entry point. Each run seeds a fresh game from wall-clock time
 * (per-run determinism only; replays/saves carry their own seed and rngState).
 */
const seed = Date.now();
const store = new GameStore(newGame(seed));

render(<App store={store} />);
