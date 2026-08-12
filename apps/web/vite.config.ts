import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `PORT` comes from `apps/web/.env` — the production build reads the same
// variable at runtime (bun loads it), so the port lives in one place for both.
// Loaded by hand because vite spawns this config without bun's .env, and vite's
// own `loadEnv` only exposes `VITE_`-prefixed keys. A missing file is fine.
try {
  process.loadEnvFile(fileURLToPath(new URL(".env", import.meta.url)));
} catch {}

const port = Number(process.env["PORT"] ?? 3001);

const config = defineConfig({
  server: { port },
  preview: { port },
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart(),
    nitro({ plugins: ["./src/access-log.ts"] }),
    viteReact(),
  ],
});

export default config;
