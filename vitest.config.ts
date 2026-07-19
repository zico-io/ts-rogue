import { defineConfig } from "vitest/config";

// Scope Vitest to src; scripts/check-docs.test.mjs runs separately under node --test.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
