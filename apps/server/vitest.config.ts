import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Bun loads this app's .env at runtime, but vitest runs on Node, so load it
// explicitly. Deliberately not vite's `loadEnv`: a second workspace depending on
// `vite` makes bun install a second copy of it, and TanStack Start's dev server
// middleware is skipped when its `vite` is not the one running the dev server.
process.loadEnvFile(fileURLToPath(new URL(".env", import.meta.url)));

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
