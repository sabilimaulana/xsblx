import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Bun loads this app's .env at runtime, but vitest runs on Node, so load it
// explicitly. `""` as the prefix means "every variable", not just VITE_*.
const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: loadEnv("", appRoot, ""),
  },
});
