import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Pure Vite, no adapter: `Cloudflare.Website.Vite` appends its own Cloudflare
 * plugin to whatever this config declares and runs one `vite build` for both the
 * client assets and the SSR Worker bundle (ADR 0019).
 *
 * `@cloudflare/vite-plugin` must never be added here — alchemy's plugin is not
 * compatible with it. The dev port lives on the resource (`dev.port`), which is
 * what `alchemy dev` boots this config with.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
});
