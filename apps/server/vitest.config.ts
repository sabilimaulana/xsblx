import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Only `.env.test` is loaded, never `.env`: tests truncate every table, so
// pointing them at the development database would delete your own data. A
// missing file fails loudly here, which is the intent.
//
// Deliberately not vite's `loadEnv`: a second workspace depending on `vite`
// makes bun install a second copy of it, and TanStack Start's dev server
// middleware is skipped when its `vite` is not the one running the dev server.
process.loadEnvFile(fileURLToPath(new URL(".env.test", import.meta.url)));

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // `*.bun.test.ts` imports the `bun` module, which node cannot resolve. Those
    // run under `bun test` — see the `test` script.
    exclude: ["src/**/*.bun.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
    // One shared test database, so files take turns. See the note in test-setup.ts.
    fileParallelism: false,
  },
});
