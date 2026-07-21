import { defineConfig } from "vite";

// The browser entry lives under src/web; the engine and ui code it imports
// are resolved relative to that root by Vite's default module resolution.
export default defineConfig({
  root: "src/web",
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
});
