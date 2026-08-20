import { defineConfig } from "vitest/config";

// No env file and no setup file: what is left to run off-platform is the contract
// tests, which decode schemas and touch no database (ADR 0020). Anything that
// needs D1 runs against a deployed stage under `bun test` — see `*.e2e.test.ts`.
//
// Deliberately not vite's `loadEnv` either: a second workspace depending on
// `vite` makes bun install a second copy of it (ADR 0006).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.e2e.test.ts"],
  },
});
